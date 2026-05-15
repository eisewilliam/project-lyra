use lyra_core::{
    config::ConfigStore,
    domain::{
        LyricDocument, LyricsStatus, NotFoundReason, PlaybackSnapshot, PlaybackState,
        RenderSnapshot, SettingsSnapshot, TrackRef,
    },
    lyrics::cache::LyricCache,
    sync::compute_render,
};
use std::collections::HashMap;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

/// Mutable, lock-protected runtime state. Does NOT hold the HTTP client
/// so commands can release this lock before awaiting network calls.
pub struct LyraRuntime {
    pub last_playback_snapshot: Option<PlaybackSnapshot>,
    pub cache: LyricCache,
    config: ConfigStore,
    settings: SettingsSnapshot,
    current_doc: Option<LyricDocument>,
    last_track_key: Option<String>,
    last_tick_ms: u64,
    last_tick_result: Option<RenderSnapshot>,
    /// In-memory map of URIs whose last fetch failed with a *transient* error
    /// (network, rate limit). Not persisted: a restart clears them, which is
    /// the right behaviour — transient by definition.
    transient_errors: HashMap<String, NotFoundReason>,
}

impl LyraRuntime {
    pub fn new() -> Self {
        let app_dir = app_support_dir();
        let config = ConfigStore::new(&app_dir);
        let settings = config.load();
        let cache = LyricCache::new(&app_dir);
        let _ = cache.ensure_dirs();

        Self {
            last_playback_snapshot: None,
            cache,
            config,
            settings,
            current_doc: None,
            last_track_key: None,
            last_tick_ms: 0,
            last_tick_result: None,
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
        self.last_playback_snapshot.as_ref().and_then(|s| s.track.clone())
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
        let _ = self.cache.put(&doc.track_key.clone(), &doc.raw_lrc.clone());
        self.current_doc = Some(doc);
        self.last_tick_result = None;
    }

    pub fn store_negative(&mut self, track_key: &str) {
        self.transient_errors.remove(track_key);
        let _ = self.cache.mark_negative(track_key);
        self.last_tick_result = None;
    }

    /// Record a transient (network/rate-limit) failure so the UI can render a
    /// distinct message instead of the generic "no lyrics" state. Cleared on
    /// the next successful fetch or on a manual force-refresh.
    pub fn store_transient_error(&mut self, track_key: &str, reason: NotFoundReason) {
        self.transient_errors.insert(track_key.to_string(), reason);
        self.last_tick_result = None;
    }

    pub fn clear_transient_error(&mut self, track_key: &str) {
        self.transient_errors.remove(track_key);
        self.last_tick_result = None;
    }

    /// Drop the negative sentinel and any cached doc so the next refresh
    /// re-queries the upstream provider. Used by the manual-retry command.
    pub fn forget_track(&mut self, track_key: &str) {
        let _ = self.cache.clear_negative(track_key);
        self.transient_errors.remove(track_key);
        if self
            .current_doc
            .as_ref()
            .is_some_and(|d| d.track_key == track_key)
        {
            self.current_doc = None;
        }
        self.last_tick_result = None;
    }

    /// Return every lyric line text for the currently loaded document.
    pub fn all_lyrics_lines(&self) -> Vec<String> {
        self.current_doc
            .as_ref()
            .map(|d| d.lines.iter().map(|l| l.text.clone()).collect())
            .unwrap_or_default()
    }

    /// Return every line with its start timestamp — used by the frontend to
    /// implement click-to-seek on the lyrics list.
    pub fn all_lines(&self) -> Vec<lyra_core::domain::LyricLine> {
        self.current_doc
            .as_ref()
            .map(|d| d.lines.clone())
            .unwrap_or_default()
    }

    /// Poll + compute render snapshot. Debounced: if called again within 150 ms
    /// returns the cached result without re-running AppleScript.
    pub fn tick(&mut self) -> RenderSnapshot {
        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;

        if now_ms.saturating_sub(self.last_tick_ms) < 150 {
            if let Some(cached) = &self.last_tick_result {
                return cached.clone();
            }
        }
        self.last_tick_ms = now_ms;

        let snapshot = self.last_playback_snapshot.clone().unwrap_or(PlaybackSnapshot {
            track: None,
            state: PlaybackState::Stopped,
            position_ms: None,
            observed_at_ms: 0,
        });

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
            (None, _) => LyricsStatus::NotFound { reason: NotFoundReason::Miss },
            (Some(_), Some(_)) => LyricsStatus::Ready,
            (Some(key), None) => {
                if self.cache.is_negative(key) {
                    LyricsStatus::NotFound { reason: NotFoundReason::Miss }
                } else if let Some(reason) = self.transient_errors.get(key).copied() {
                    LyricsStatus::NotFound { reason }
                } else {
                    LyricsStatus::Loading
                }
            }
        };

        let result = compute_render(snapshot, self.current_doc.as_ref(), status, above, below);
        self.last_tick_result = Some(result.clone());
        result
    }
}

fn app_support_dir() -> PathBuf {
    dirs_next::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("Lyra")
}
