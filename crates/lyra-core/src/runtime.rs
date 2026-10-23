use crate::{
    config::ConfigStore,
    domain::{
        BrowserLyrics, LyricDocument, LyricsStatus, NotFoundReason, PlaybackSnapshot,
        PlaybackState, RenderSnapshot, SettingsSnapshot, TrackRef,
    },
    lyrics::cache::LyricCache,
    lyrics::offsets::OffsetStore,
    sync::compute_render,
};
use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

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
    current_doc: Option<LyricDocument>,
    last_track_key: Option<String>,
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
            current_doc: None,
            last_track_key: None,
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

    pub fn set_playback_snapshot(&mut self, snap: PlaybackSnapshot) {
        self.last_playback_snapshot = Some(snap);
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
            self.current_doc = Some(doc);
        }
    }

    pub fn store_negative(&mut self, track_key: &str) {
        self.transient_errors.remove(track_key);
        let cache = self.cache.clone();
        let track_key = track_key.to_string();
        spawn_cache_write(move || {
            let _ = cache.mark_negative(&track_key);
        });
    }

    /// Record a transient (network/rate-limit) failure so the UI can render a
    /// distinct message instead of the generic "no lyrics" state. Cleared on
    /// the next successful fetch or on a manual force-refresh.
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
            .current_doc
            .as_ref()
            .is_some_and(|d| d.track_key == track_key)
        {
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
        SeekPreview {
            playback: render.playback,
            doc: self.current_doc.clone(),
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

        if track_key != self.last_track_key {
            self.last_track_key = track_key.clone();
            self.current_doc = None;
            if let Some(ref key) = track_key {
                self.current_doc = self.cache.get(key);
            }
        }

        let above = self.settings.appearance.context_lines_above as usize;
        let below = self.settings.appearance.context_lines_below as usize;

        let status = match (&track_key, &self.current_doc) {
            (None, _) => LyricsStatus::NotFound {
                reason: NotFoundReason::Miss,
            },
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

        compute_render(
            snapshot,
            self.current_doc.as_ref(),
            status,
            above,
            below,
            offset_ms,
        )
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
