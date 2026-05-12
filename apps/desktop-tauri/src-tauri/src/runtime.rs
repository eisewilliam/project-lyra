use lyra_core::{
    config::ConfigStore,
    domain::{LyricDocument, LyricsStatus, PlaybackSnapshot, PlaybackState, RenderSnapshot, SettingsSnapshot, TrackRef},
    lyrics::cache::LyricCache,
    sync::compute_render,
};
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
        let _ = self.cache.put(&doc.track_key.clone(), &doc.raw_lrc.clone());
        self.current_doc = Some(doc);
    }

    pub fn store_negative(&mut self, track_key: &str) {
        let _ = self.cache.mark_negative(track_key);
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
            (None, _) => LyricsStatus::NotFound,
            (Some(_), Some(_)) => LyricsStatus::Ready,
            (Some(key), None) => {
                if self.cache.is_negative(key) {
                    LyricsStatus::NotFound
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
