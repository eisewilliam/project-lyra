use crate::{
    config::ConfigStore,
    domain::{
        durations_differ, BrowserLyrics, LyricDocument, LyricsStatus, NotFoundReason,
        PlaybackSnapshot, PlaybackState, RenderSnapshot, SettingsSnapshot, TrackRef,
    },
    lyrics::cache::LyricCache,
    lyrics::offsets::OffsetStore,
    player::metadata::duration_variant_key,
    sync::compute_render,
};
use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

/// How long a newly seen track may report no duration before lyrics are
/// shown or looked up without one. Players report 0 for a moment while a
/// track or music video loads; lyrics chosen in that window could not be
/// checked against the length actually playing. Players that never report
/// a duration wait this long, then behave as before.
pub const DURATION_GRACE: Duration = Duration::from_secs(4);

/// The lyric key last chosen for an adapter's track key at one duration.
#[derive(Clone, Debug)]
struct KeyChoice {
    base: String,
    duration_ms: u64,
    key: String,
}

/// IPC-only projection of a `LyricLine`. The frontend's `get_all_lines`
/// callers read only the start timestamp + text — sending the full
/// `LyricLine` (with words) wastes serialization and clone cost.
#[derive(Clone, Debug, Serialize)]
pub struct LyricLineSlim {
    pub start_ms: u64,
    pub text: String,
}

/// Everything needed to render the current track at any position without
/// the runtime lock: taken once when someone starts dragging to seek, then
/// rendered at each point the drag passes.
#[derive(Clone, Debug)]
pub struct SeekPreview {
    playback: PlaybackSnapshot,
    doc: Option<LyricDocument>,
    status: LyricsStatus,
    context_above: usize,
    context_below: usize,
    offset_ms: i64,
}

impl SeekPreview {
    pub fn track(&self) -> Option<&TrackRef> {
        self.playback.track.as_ref()
    }

    /// The track's length, when the player reports one.
    pub fn duration_ms(&self) -> Option<u64> {
        let track = self.playback.track.as_ref()?;
        (track.duration_ms > 0).then_some(track.duration_ms)
    }

    /// The render the surfaces would show with playback at `position_ms`,
    /// honouring the track's lyric offset.
    pub fn render_at(&self, position_ms: u64) -> RenderSnapshot {
        let mut playback = self.playback.clone();
        playback.position_ms = Some(position_ms);
        compute_render(
            playback,
            self.doc.as_ref(),
            self.status.clone(),
            self.context_above,
            self.context_below,
            self.offset_ms,
        )
    }
}

/// Mutable, lock-protected runtime state. Does NOT hold the HTTP client
/// so commands can release this lock before awaiting network calls.
pub struct LyraRuntime {
    pub last_playback_snapshot: Option<PlaybackSnapshot>,
    pub cache: LyricCache,
    offsets: OffsetStore,
    config: ConfigStore,
    settings: SettingsSnapshot,
    /// Lyrics stored under the current track key, as cached.
    stored_doc: Option<LyricDocument>,
    /// Lyrics stored under the adapter's own key while the current key is
    /// a duration variant of it. Shown without timing when the variant has
    /// none of its own.
    base_doc: Option<LyricDocument>,
    /// What surfaces show: `stored_doc`, without timing when its timings were
    /// made for a recording of another length.
    current_doc: Option<LyricDocument>,
    /// Playing duration `current_doc` was prepared for.
    presented_for_ms: u64,
    last_track_key: Option<String>,
    /// Adapter track key last seen, when it appeared or stopped reporting
    /// its length, and whether it reported one last time.
    seen: Option<(String, Instant, bool)>,
    duration_grace: Duration,
    key_choice: Option<KeyChoice>,
    /// In-memory map of URIs whose last fetch failed with a *transient* error
    /// (network, rate limit). Not persisted: a restart clears them, which is
    /// the right behaviour — transient by definition.
    transient_errors: HashMap<String, NotFoundReason>,
}

impl LyraRuntime {
    pub fn new_in(app_dir: PathBuf) -> Self {
        let config = ConfigStore::new(&app_dir);
        let settings = config.load();
        let cache = LyricCache::new(&app_dir);
        let _ = cache.ensure_dirs();
        let offsets = OffsetStore::new(&app_dir);

        Self {
            last_playback_snapshot: None,
            cache,
            offsets,
            config,
            settings,
            stored_doc: None,
            base_doc: None,
            current_doc: None,
            presented_for_ms: 0,
            last_track_key: None,
            seen: None,
            duration_grace: DURATION_GRACE,
            key_choice: None,
            transient_errors: HashMap::new(),
        }
    }

    pub fn settings(&self) -> &SettingsSnapshot {
        &self.settings
    }

    pub fn update_settings(&mut self, s: SettingsSnapshot) {
        self.settings = s.clone();
        let _ = self.config.save(&s);
    }

    pub fn current_track(&self) -> Option<TrackRef> {
        self.last_playback_snapshot
            .as_ref()
            .and_then(|s| s.track.clone())
    }

    /// Manual lyric timing offset (ms) for the currently playing track.
    /// Positive delays the lyrics, negative advances them.
    pub fn current_offset(&self) -> i64 {
        self.last_track_key
            .as_deref()
            .map(|k| self.offsets.get(k))
            .unwrap_or(0)
    }

    /// Persist a new offset for the current track; the next render reflects it.
    pub fn set_current_offset(&mut self, offset_ms: i64) {
        if let Some(key) = self.last_track_key.clone() {
            self.offsets.set(&key, offset_ms);
        }
    }

    /// Why a provider lookup is not allowed for `track`, if it is not.
    /// Cached and user-supplied lyrics still show; only network lookups for
    /// browser media wait for the user's consent.
    pub fn lookup_blocked(&self, track: &TrackRef) -> Option<NotFoundReason> {
        if !track.from_browser {
            return None;
        }
        match self.settings.behavior.browser_lyrics {
            BrowserLyrics::Allow => None,
            BrowserLyrics::Ask => Some(NotFoundReason::ConsentRequired),
            BrowserLyrics::Deny => Some(NotFoundReason::LookupDisabled),
        }
    }

    /// Record the latest player observation. A track whose key has no
    /// duration in it (a native ID a player may reuse for a song and its
    /// music video) is moved to a per-length key when the lyrics or miss
    /// cached under its own key were made for a recording of another length,
    /// so the versions keep separate lyrics, misses and offsets.
    pub fn set_playback_snapshot(&mut self, mut snap: PlaybackSnapshot) {
        if let Some(track) = snap.track.as_mut() {
            let base = self.adapter_key(&track.uri);
            let has_length = track.duration_ms > 0;
            // A new track, or one that stopped reporting its length (a
            // player switching the same track to its music video), starts
            // the wait for a length again.
            let restart = match &self.seen {
                Some((seen, _, had_length)) => *seen != base || (*had_length && !has_length),
                None => true,
            };
            match self.seen.as_mut() {
                Some(seen) if !restart => seen.2 = has_length,
                _ => self.seen = Some((base.clone(), Instant::now(), has_length)),
            }
            track.uri = self.lyric_key(base, track.duration_ms);
        }
        self.last_playback_snapshot = Some(snap);
    }

    /// The adapter's key for `uri`, undoing `lyric_key`.
    fn adapter_key(&self, uri: &str) -> String {
        match &self.key_choice {
            Some(choice) if choice.key == uri => choice.base.clone(),
            _ => uri.to_string(),
        }
    }

    fn lyric_key(&mut self, base: String, duration_ms: u64) -> String {
        if duration_ms == 0 || base.starts_with("meta::") {
            return base;
        }
        if let Some(choice) = self
            .key_choice
            .as_ref()
            .filter(|c| c.base == base && c.duration_ms == duration_ms)
        {
            return choice.key.clone();
        }
        let key = match self.cache.recorded_duration(&base) {
            Some(recorded) if durations_differ(recorded, duration_ms) => {
                duration_variant_key(&base, duration_ms)
            }
            _ => base.clone(),
        };
        self.key_choice = Some(KeyChoice {
            base,
            duration_ms,
            key: key.clone(),
        });
        key
    }

    /// The track has just appeared and does not report its length yet.
    /// Lyrics are neither shown nor looked up until it does, or until
    /// `DURATION_GRACE` passes.
    pub fn duration_pending(&self, track: &TrackRef) -> bool {
        track.duration_ms == 0
            && self.seen.as_ref().is_some_and(|(base, at, _)| {
                *base == self.adapter_key(&track.uri) && at.elapsed() < self.duration_grace
            })
    }

    fn playing_duration_ms(&self) -> u64 {
        self.last_playback_snapshot
            .as_ref()
            .and_then(|s| s.track.as_ref())
            .map_or(0, |t| t.duration_ms)
    }

    /// Prepare `current_doc` from `stored_doc` for the playing duration.
    fn present(&mut self, duration_ms: u64) {
        self.presented_for_ms = duration_ms;
        self.current_doc = self.stored_doc.as_ref().map(|doc| {
            if !doc.lines.is_empty() && doc.timed_for_other_duration(duration_ms) {
                doc.without_timing()
            } else {
                doc.clone()
            }
        });
    }

    pub fn is_negative(&self, track_key: &str) -> bool {
        self.cache.is_negative(track_key)
    }

    pub fn get_cached(&self, track_key: &str) -> Option<LyricDocument> {
        self.cache.get(track_key)
    }

    pub fn store_lyrics(&mut self, doc: LyricDocument) {
        self.transient_errors.remove(&doc.track_key);
        let cache = self.cache.clone();
        let cached_doc = doc.clone();
        spawn_cache_write(move || {
            let _ = cache.put_document(&cached_doc);
        });
        if self.last_track_key.as_deref() == Some(&doc.track_key) {
            self.stored_doc = Some(doc);
            self.present(self.playing_duration_ms());
        }
    }

    /// Record a confirmed miss for `track_key`, looked up at `duration_ms`
    /// (0 when unknown).
    pub fn store_negative(&mut self, track_key: &str, duration_ms: u64) {
        self.transient_errors.remove(track_key);
        let cache = self.cache.clone();
        let track_key = track_key.to_string();
        spawn_cache_write(move || {
            let _ = cache.mark_negative_for(&track_key, duration_ms);
        });
    }

    /// Record a transient (network/rate-limit) failure so the UI can render a
    /// distinct message instead of the generic "no lyrics" state. Cleared on
    /// the next successful fetch, on a manual force-refresh, and whenever the
    /// playing track changes.
    pub fn store_transient_error(&mut self, track_key: &str, reason: NotFoundReason) {
        self.transient_errors.insert(track_key.to_string(), reason);
    }

    pub fn clear_transient_error(&mut self, track_key: &str) {
        self.transient_errors.remove(track_key);
    }

    pub fn has_transient_error(&self, track_key: &str) -> bool {
        self.transient_errors.contains_key(track_key)
    }

    /// Clear the negative sentinel, transient failure, and active document.
    /// Cached lyric files remain intact. Used by the manual-retry coordinator.
    pub fn forget_track(&mut self, track_key: &str) {
        let cache = self.cache.clone();
        let track_key_owned = track_key.to_string();
        spawn_cache_write(move || {
            let _ = cache.clear_negative(&track_key_owned);
        });
        self.transient_errors.remove(track_key);
        if self
            .stored_doc
            .as_ref()
            .is_some_and(|d| d.track_key == track_key)
        {
            self.stored_doc = None;
            self.current_doc = None;
        }
    }

    /// Plain lyrics have no timestamps and are displayed only by the main pane.
    pub fn all_plain_lyrics(&self) -> Option<String> {
        self.current_doc
            .as_ref()
            .and_then(|doc| doc.plain_lyrics.clone())
    }

    /// Return every lyric line text for the currently loaded document.
    pub fn all_lyrics_lines(&self) -> Vec<String> {
        self.current_doc
            .as_ref()
            .map(|d| d.lines.iter().map(|l| l.text.clone()).collect())
            .unwrap_or_default()
    }

    /// Return every line as a slim `(start_ms, text)` tuple — used by the
    /// frontend to implement click-to-seek on the lyrics list. Avoids cloning
    /// the per-line `Option<Vec<LyricWord>>` payload which the UI never reads.
    pub fn all_lines_slim(&self) -> Vec<LyricLineSlim> {
        self.current_doc
            .as_ref()
            .map(|d| {
                d.lines
                    .iter()
                    .map(|l| LyricLineSlim {
                        start_ms: l.start_ms,
                        text: l.text.clone(),
                    })
                    .collect()
            })
            .unwrap_or_default()
    }

    /// A copy of the current track's lyrics and timing for previewing a seek.
    pub fn seek_preview(&mut self) -> SeekPreview {
        let render = self.tick();
        let pending = render
            .playback
            .track
            .as_ref()
            .is_some_and(|track| self.duration_pending(track));
        SeekPreview {
            playback: render.playback,
            doc: self.current_doc.clone().filter(|_| !pending),
            status: render.lyrics_status,
            context_above: self.settings.appearance.context_lines_above as usize,
            context_below: self.settings.appearance.context_lines_below as usize,
            offset_ms: self.current_offset(),
        }
    }

    /// Compute a fresh render snapshot from the last adapter observation.
    /// Playing positions are extrapolated without mutating that observation.
    pub fn tick(&mut self) -> RenderSnapshot {
        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;

        let mut snapshot = self
            .last_playback_snapshot
            .clone()
            .unwrap_or_else(|| PlaybackSnapshot::stopped(0));

        if snapshot.state == PlaybackState::Playing {
            if let Some(pos) = snapshot.position_ms {
                if snapshot.observed_at_ms > 0 {
                    let elapsed = now_ms.saturating_sub(snapshot.observed_at_ms);
                    snapshot.position_ms = Some(pos + scale_by_rate(elapsed, snapshot.rate));
                    snapshot.observed_at_ms = now_ms;
                }
            }
        }

        let track_key = snapshot.track.as_ref().map(|t| t.uri.clone());

        let duration_ms = snapshot.track.as_ref().map_or(0, |t| t.duration_ms);
        if track_key != self.last_track_key {
            self.last_track_key = track_key.clone();
            // Failures are only retried while their track plays, so one left
            // from an earlier play (or a background probe) would never clear.
            // Forget them; the track shows `Loading` and is looked up again.
            self.transient_errors.clear();
            self.stored_doc = track_key.as_deref().and_then(|key| self.cache.get(key));
            self.base_doc = track_key
                .as_deref()
                .map(|key| self.adapter_key(key))
                .filter(|base| Some(base) != track_key.as_ref())
                .and_then(|base| self.cache.get(&base));
            self.present(duration_ms);
        } else if duration_ms != self.presented_for_ms {
            self.present(duration_ms);
        }
        let pending = snapshot
            .track
            .as_ref()
            .is_some_and(|track| self.duration_pending(track));
        // This length has no lyrics of its own; the other version's words
        // still help, but not its timing.
        if self.current_doc.is_none() {
            if let (Some(key), Some(base)) = (&track_key, &self.base_doc) {
                let words = base.without_timing();
                if words.plain_lyrics.is_some() && self.cache.is_negative(key) {
                    self.current_doc = Some(words);
                }
            }
        }

        let above = self.settings.appearance.context_lines_above as usize;
        let below = self.settings.appearance.context_lines_below as usize;

        let doc = self.current_doc.as_ref().filter(|_| !pending);
        let status = match (&track_key, doc) {
            (None, _) => LyricsStatus::NotFound {
                reason: NotFoundReason::Miss,
            },
            (Some(_), _) if pending => LyricsStatus::Loading,
            (Some(_), Some(_)) => LyricsStatus::Ready,
            (Some(key), None) => {
                if self.cache.is_negative(key) {
                    LyricsStatus::NotFound {
                        reason: NotFoundReason::Miss,
                    }
                } else if let Some(reason) = self.transient_errors.get(key).copied() {
                    LyricsStatus::NotFound { reason }
                } else if let Some(reason) = snapshot
                    .track
                    .as_ref()
                    .and_then(|track| self.lookup_blocked(track))
                {
                    LyricsStatus::NotFound { reason }
                } else {
                    LyricsStatus::Loading
                }
            }
        };

        let offset_ms = track_key
            .as_deref()
            .map(|k| self.offsets.get(k))
            .unwrap_or(0);

        compute_render(snapshot, doc, status, above, below, offset_ms)
    }

    /// Find the next lyric transition timestamp (in playback time) relative to `current_pos_ms`.
    /// Returns `None` if there is no next transition (e.g. no lyrics, stopped, or on the last line).
    pub fn next_transition_playback_ms(&self, current_pos_ms: u64) -> Option<u64> {
        let doc = self.current_doc.as_ref()?;
        if doc.lines.is_empty() {
            return None;
        }

        let offset_ms = self.current_offset();

        // Convert current playback position to lyric-space position
        let lyric_pos = (current_pos_ms as i64 - offset_ms).max(0) as u64;

        let active_idx = crate::sync::find_active_line(&doc.lines, lyric_pos);

        let next_lyric_ms = match active_idx {
            None => {
                // Before the first line
                Some(doc.lines[0].start_ms)
            }
            Some(idx) => {
                if idx + 1 < doc.lines.len() {
                    Some(doc.lines[idx + 1].start_ms)
                } else {
                    None
                }
            }
        };

        // Convert the next lyric transition time back to playback time
        next_lyric_ms.map(|t| (t as i64 + offset_ms).max(0) as u64)
    }
}

/// Playback-time elapsed for `wall_ms` of wall-clock time. Non-finite or
/// negative rates from a misbehaving player fall back to normal speed.
pub fn scale_by_rate(wall_ms: u64, rate: f64) -> u64 {
    if rate.is_finite() && rate >= 0.0 {
        (wall_ms as f64 * rate).round() as u64
    } else {
        wall_ms
    }
}

#[cfg(test)]
impl LyraRuntime {
    pub(crate) fn set_duration_grace(&mut self, grace: Duration) {
        self.duration_grace = grace;
    }
}

fn spawn_cache_write<F>(write: F)
where
    F: FnOnce() + Send + 'static,
{
    if let Ok(handle) = tokio::runtime::Handle::try_current() {
        handle.spawn(async move {
            write();
        });
    } else {
        write();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{LyricLine, LyricSourceKind};

    fn test_track(uri: &str, duration_ms: u64) -> TrackRef {
        TrackRef {
            duration_ms,
            ..TrackRef::fixture(uri)
        }
    }

    fn make_test_doc(timestamps: &[u64]) -> LyricDocument {
        let mut lines = Vec::new();
        let len = timestamps.len();
        for i in 0..len {
            let start_ms = timestamps[i];
            let end_ms = if i + 1 < len {
                Some(timestamps[i + 1])
            } else {
                None
            };
            lines.push(LyricLine {
                start_ms,
                end_ms,
                text: format!("Line {}", i),
                words: None,
            });
        }
        LyricDocument {
            track_key: "test_key".to_string(),
            source: LyricSourceKind::Lrclib,
            lines,
            raw_lrc: "".to_string(),
            plain_lyrics: None,
            source_duration_ms: None,
        }
    }

    #[test]
    fn plain_document_roundtrips_without_timed_overlay_lines() {
        let dir = std::env::temp_dir().join(format!("lyra-plain-runtime-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let mut rt = LyraRuntime::new_in(dir.clone());
        let playback = PlaybackSnapshot {
            track: Some(test_track("test_key", 10000)),
            state: PlaybackState::Paused,
            position_ms: Some(2000),
            ..PlaybackSnapshot::stopped(0)
        };
        rt.set_playback_snapshot(playback.clone());
        rt.tick();
        let mut doc = make_test_doc(&[]);
        doc.plain_lyrics = Some("First line\nSecond line".into());
        rt.store_lyrics(doc);
        let render = rt.tick();
        assert!(matches!(render.lyrics_status, LyricsStatus::Unsynced));
        assert!(render.visible_lines.is_empty());
        assert!(render.active_line_index.is_none());
        assert!(rt.all_lines_slim().is_empty());
        assert_eq!(rt.next_transition_playback_ms(2000), None);
        assert_eq!(
            rt.all_plain_lyrics().as_deref(),
            Some("First line\nSecond line")
        );
        let mut restored = LyraRuntime::new_in(dir.clone());
        restored.set_playback_snapshot(playback);
        assert!(matches!(
            restored.tick().lyrics_status,
            LyricsStatus::Unsynced
        ));
        assert_eq!(restored.all_plain_lyrics(), rt.all_plain_lyrics());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn test_tick_extrapolates_position_and_does_not_mutate_canonical() {
        let temp_dir = std::env::temp_dir().join("lyra_test_tick");
        let _ = std::fs::remove_dir_all(&temp_dir);
        let mut rt = LyraRuntime::new_in(temp_dir);
        let original_snap = PlaybackSnapshot {
            track: Some(test_track("spotify:track:1", 180000)),
            state: PlaybackState::Playing,
            position_ms: Some(10000),
            observed_at_ms: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_millis() as u64
                - 200, // 200ms ago
            ..PlaybackSnapshot::stopped(0)
        };
        rt.set_playback_snapshot(original_snap.clone());

        // Check tick() returns extrapolated position
        let render = rt.tick();
        assert!(render.playback.position_ms.unwrap() > 10000);
        let elapsed = render.playback.observed_at_ms - original_snap.observed_at_ms;
        assert_eq!(
            render.playback.position_ms.unwrap(),
            original_snap.position_ms.unwrap() + elapsed
        );

        // Check canonical last_playback_snapshot is unchanged
        let canonical = rt.last_playback_snapshot.as_ref().unwrap();
        assert_eq!(canonical.position_ms.unwrap(), 10000);
        assert_eq!(canonical.observed_at_ms, original_snap.observed_at_ms);
    }

    #[test]
    fn tick_extrapolates_at_the_player_playback_rate() {
        let temp_dir = std::env::temp_dir().join(format!("lyra-rate-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&temp_dir);
        let mut rt = LyraRuntime::new_in(temp_dir.clone());
        let observed_at_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64
            - 1_000;
        rt.set_playback_snapshot(PlaybackSnapshot {
            track: Some(test_track("spotify:track:rate", 180000)),
            state: PlaybackState::Playing,
            position_ms: Some(10_000),
            observed_at_ms,
            rate: 2.0,
            ..PlaybackSnapshot::stopped(0)
        });
        let render = rt.tick();
        let wall = render.playback.observed_at_ms - observed_at_ms;
        assert_eq!(render.playback.position_ms, Some(10_000 + wall * 2));
        let _ = std::fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn seek_preview_renders_any_position_with_the_lyric_offset() {
        let dir = std::env::temp_dir().join(format!("lyra-seek-preview-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let mut rt = LyraRuntime::new_in(dir.clone());
        rt.set_playback_snapshot(PlaybackSnapshot {
            track: Some(test_track("test_key", 20_000)),
            state: PlaybackState::Paused,
            position_ms: Some(2_000),
            ..PlaybackSnapshot::stopped(0)
        });
        rt.tick();
        rt.store_lyrics(make_test_doc(&[1_000, 5_000, 10_000]));
        rt.set_current_offset(500);

        let preview = rt.seek_preview();
        assert_eq!(preview.duration_ms(), Some(20_000));
        // Line 1 starts 5 s into the lyrics: 5.5 s into playback.
        assert_eq!(preview.render_at(5_400).active_line_index, Some(0));
        assert_eq!(preview.render_at(5_500).active_line_index, Some(1));
        assert_eq!(preview.render_at(0).active_line_index, None);
        // Previewing leaves playback where it is.
        assert_eq!(rt.tick().playback.position_ms, Some(2_000));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn seek_preview_has_no_duration_for_unknown_lengths() {
        let dir = std::env::temp_dir().join(format!("lyra-seek-length-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let mut rt = LyraRuntime::new_in(dir.clone());
        assert_eq!(rt.seek_preview().duration_ms(), None);
        rt.set_playback_snapshot(PlaybackSnapshot {
            track: Some(test_track("live", 0)),
            state: PlaybackState::Playing,
            ..PlaybackSnapshot::stopped(0)
        });
        assert_eq!(rt.seek_preview().duration_ms(), None);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn busy_failure_is_forgotten_when_the_track_changes() {
        let dir = std::env::temp_dir().join(format!("lyra-busy-forgotten-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let mut rt = LyraRuntime::new_in(dir.clone());
        let play = |rt: &mut LyraRuntime, uri: &str| {
            rt.set_playback_snapshot(PlaybackSnapshot {
                track: Some(test_track(uri, 180_000)),
                state: PlaybackState::Playing,
                ..PlaybackSnapshot::stopped(0)
            });
            rt.tick().lyrics_status
        };
        let busy = |status: LyricsStatus| {
            matches!(
                status,
                LyricsStatus::NotFound {
                    reason: NotFoundReason::RateLimit
                }
            )
        };

        play(&mut rt, "spotify:track:a");
        rt.store_transient_error("spotify:track:a", NotFoundReason::RateLimit);
        // A background probe of another track failed too.
        rt.store_transient_error("spotify:track:b", NotFoundReason::RateLimit);
        assert!(busy(rt.tick().lyrics_status));

        // The probed track starts playing: it is looked up, not shown busy.
        assert!(matches!(
            play(&mut rt, "spotify:track:b"),
            LyricsStatus::Loading
        ));
        // Returning to the first track looks it up again too.
        assert!(matches!(
            play(&mut rt, "spotify:track:a"),
            LyricsStatus::Loading
        ));
        assert!(!rt.has_transient_error("spotify:track:a"));

        // A failure of the playing track still shows until the track changes.
        rt.store_transient_error("spotify:track:a", NotFoundReason::RateLimit);
        assert!(busy(rt.tick().lyrics_status));
        let _ = std::fs::remove_dir_all(dir);
    }

    fn timed_doc(key: &str, source_duration_ms: Option<u64>) -> LyricDocument {
        // Real LRC text, so the document survives a cache round trip.
        let mut doc = crate::lyrics::parser::parse_lrc(
            key,
            "[00:01.00]Line 0\n[00:05.00]Line 1\n[00:10.00]Line 2",
            LyricSourceKind::Lrclib,
        )
        .unwrap();
        doc.source_duration_ms = source_duration_ms;
        doc
    }

    fn playing(rt: &mut LyraRuntime, uri: &str, duration_ms: u64) -> RenderSnapshot {
        rt.set_playback_snapshot(PlaybackSnapshot {
            track: Some(test_track(uri, duration_ms)),
            state: PlaybackState::Paused,
            position_ms: Some(6_000),
            ..PlaybackSnapshot::stopped(0)
        });
        rt.tick()
    }

    fn fresh_runtime(name: &str) -> (LyraRuntime, PathBuf) {
        let dir = std::env::temp_dir().join(format!("lyra-video-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        (LyraRuntime::new_in(dir.clone()), dir)
    }

    #[test]
    fn music_video_sharing_a_track_id_gets_its_own_lyrics_and_offset() {
        let (mut rt, dir) = fresh_runtime("own-key");
        let song = "spotify:track:song";
        // The album audio plays first and gets lyrics timed to it.
        playing(&mut rt, song, 220_000);
        rt.store_lyrics(timed_doc(song, Some(220_000)));
        rt.set_current_offset(400);
        assert!(matches!(rt.tick().lyrics_status, LyricsStatus::Ready));

        // Its music video reports the same ID but runs much longer.
        let render = playing(&mut rt, song, 571_000);
        let video = render.playback.track.as_ref().unwrap().uri.clone();
        assert_eq!(video, "spotify:track:song::571");
        assert!(matches!(render.lyrics_status, LyricsStatus::Loading));
        assert_eq!(rt.current_offset(), 0, "the audio's offset stays with it");

        // No lyrics for the video: the song's words show, without timing.
        rt.store_negative(&video, 571_000);
        let render = rt.tick();
        assert!(matches!(render.lyrics_status, LyricsStatus::Unsynced));
        assert_eq!(
            rt.all_plain_lyrics().as_deref(),
            Some("Line 0\nLine 1\nLine 2")
        );
        assert_eq!(rt.next_transition_playback_ms(6_000), None);

        // Lyrics timed to the video, and an offset, stay with the video.
        rt.store_lyrics(timed_doc(&video, Some(571_000)));
        rt.set_current_offset(-250);
        assert!(matches!(rt.tick().lyrics_status, LyricsStatus::Ready));

        // Back to the audio: its own key, lyrics and offset.
        let render = playing(&mut rt, song, 220_000);
        assert_eq!(render.playback.track.as_ref().unwrap().uri, song);
        assert!(matches!(render.lyrics_status, LyricsStatus::Ready));
        assert_eq!(rt.current_offset(), 400);
        playing(&mut rt, song, 571_000);
        assert_eq!(rt.current_offset(), -250);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn miss_for_a_video_moves_the_audio_to_its_own_key() {
        let (mut rt, dir) = fresh_runtime("miss-key");
        let song = "spotify:track:first-video";
        playing(&mut rt, song, 571_000);
        rt.store_negative(song, 571_000);
        let render = playing(&mut rt, song, 220_000);
        assert_eq!(
            render.playback.track.as_ref().unwrap().uri,
            "spotify:track:first-video::220"
        );
        assert!(matches!(render.lyrics_status, LyricsStatus::Loading));
        // Lengths within the tolerance are the same recording.
        let render = playing(&mut rt, song, 573_000);
        assert_eq!(render.playback.track.as_ref().unwrap().uri, song);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn lyrics_timed_for_another_length_are_shown_unsynced() {
        let (mut rt, dir) = fresh_runtime("mismatch");
        // Metadata keys carry their duration, so are never re-keyed.
        let video = "meta::artist::telephone::571";
        playing(&mut rt, video, 571_000);
        rt.store_lyrics(timed_doc(video, Some(220_000)));
        let render = rt.tick();
        assert!(matches!(render.lyrics_status, LyricsStatus::Unsynced));
        assert!(render.visible_lines.is_empty());
        assert!(rt.all_lines_slim().is_empty());
        assert_eq!(rt.seek_preview().render_at(6_000).active_line_index, None);

        // Within the tolerance, or with either length unknown, timing stays.
        for (source, playing_ms) in [
            (Some(566_000), 571_000),
            (None, 571_000),
            (Some(220_000), 0),
        ] {
            let key = format!("meta::artist::song::{source:?}::{playing_ms}");
            rt.set_duration_grace(Duration::ZERO);
            playing(&mut rt, &key, playing_ms);
            rt.store_lyrics(timed_doc(&key, source));
            let render = rt.tick();
            assert!(
                matches!(render.lyrics_status, LyricsStatus::Ready),
                "{source:?} vs {playing_ms}"
            );
            assert_eq!(render.active_line_index, Some(1));
        }
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn lyrics_wait_while_the_player_reports_no_duration() {
        let (mut rt, dir) = fresh_runtime("zero-duration");
        let song = "spotify:track:loading";
        playing(&mut rt, song, 220_000);
        rt.store_lyrics(timed_doc(song, Some(220_000)));

        // Another track loads with no length yet: nothing is shown.
        let other = "spotify:track:loading-video";
        let render = playing(&mut rt, other, 0);
        assert!(rt.duration_pending(render.playback.track.as_ref().unwrap()));
        assert!(matches!(render.lyrics_status, LyricsStatus::Loading));

        // The song again, reporting 0 while its video loads: its album
        // lyrics are held back until the length is known.
        let render = playing(&mut rt, song, 0);
        assert!(matches!(render.lyrics_status, LyricsStatus::Loading));
        assert!(render.visible_lines.is_empty());
        assert!(rt.seek_preview().render_at(6_000).visible_lines.is_empty());
        let render = playing(&mut rt, song, 571_000);
        assert_eq!(
            render.playback.track.as_ref().unwrap().uri,
            "spotify:track:loading::571"
        );

        // Switching the playing song to its video: the length drops to 0
        // for a moment, and the song's timing is not shown meanwhile.
        assert!(matches!(
            playing(&mut rt, song, 220_000).lyrics_status,
            LyricsStatus::Ready
        ));
        let render = playing(&mut rt, song, 0);
        assert!(matches!(render.lyrics_status, LyricsStatus::Loading));

        // A player that never reports a length is served after the grace.
        rt.set_duration_grace(Duration::ZERO);
        let render = playing(&mut rt, song, 0);
        assert!(matches!(render.lyrics_status, LyricsStatus::Ready));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn lyrics_cached_before_lengths_were_recorded_keep_their_key() {
        let (mut rt, dir) = fresh_runtime("legacy");
        let song = "spotify:track:legacy";
        rt.cache
            .put(song, "[00:01.00]Old\n[00:05.00]Cache")
            .unwrap();
        let render = playing(&mut rt, song, 571_000);
        assert_eq!(render.playback.track.as_ref().unwrap().uri, song);
        assert!(matches!(render.lyrics_status, LyricsStatus::Ready));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn scale_by_rate_ignores_invalid_rates() {
        assert_eq!(scale_by_rate(1_000, 1.5), 1_500);
        assert_eq!(scale_by_rate(1_000, 0.0), 0);
        assert_eq!(scale_by_rate(1_000, f64::NAN), 1_000);
        assert_eq!(scale_by_rate(1_000, -1.0), 1_000);
    }

    #[test]
    fn test_next_transition_playback_ms_offset_aware() {
        let temp_dir = std::env::temp_dir().join("lyra_test_next_transition");
        let _ = std::fs::remove_dir_all(&temp_dir);
        let mut rt = LyraRuntime::new_in(temp_dir);
        let doc = make_test_doc(&[1000, 5000, 10000]);
        rt.current_doc = Some(doc);
        rt.last_track_key = Some("test_key".to_string());

        // Test with offset = 0
        rt.set_current_offset(0);
        // Before line 0: transition should be start_ms of line 0 (1000ms)
        assert_eq!(rt.next_transition_playback_ms(100), Some(1000));
        // Inside line 0 (2000ms): transition should be start_ms of line 1 (5000ms)
        assert_eq!(rt.next_transition_playback_ms(2000), Some(5000));
        // Inside line 1 (6000ms): transition should be start_ms of line 2 (10000ms)
        assert_eq!(rt.next_transition_playback_ms(6000), Some(10000));
        // On last line (11000ms): transition should be None
        assert_eq!(rt.next_transition_playback_ms(11000), None);

        // Test with offset = 500 (lyrics delayed, meaning transition happens later in playback time)
        rt.set_current_offset(500);
        // Lyric pos for playback 100 is 100 - 500 = -400 -> 0. Next lyric is line 0 at 1000.
        // Playback transition = 1000 + 500 = 1500ms
        assert_eq!(rt.next_transition_playback_ms(100), Some(1500));
        // Lyric pos for playback 2000 is 2000 - 500 = 1500. Active line is line 0 (starts at 1000).
        // Next lyric is line 1 at 5000. Playback transition = 5000 + 500 = 5500ms
        assert_eq!(rt.next_transition_playback_ms(2000), Some(5500));

        // Test with offset = -300 (lyrics advanced, meaning transition happens earlier in playback time)
        rt.set_current_offset(-300);
        // Lyric pos for playback 100 is 100 - (-300) = 400. Active line is None.
        // Next lyric is line 0 at 1000. Playback transition = 1000 - 300 = 700ms
        assert_eq!(rt.next_transition_playback_ms(100), Some(700));
        // Lyric pos for playback 2000 is 2000 - (-300) = 2300. Active line is line 0.
        // Next lyric is line 1 at 5000. Playback transition = 5000 - 300 = 4700ms
        assert_eq!(rt.next_transition_playback_ms(2000), Some(4700));
    }
}
