use lyra_core::{
    config::ConfigStore,
    domain::{LyricDocument, LyricsStatus, PlaybackSnapshot, PlaybackState, RenderSnapshot, SettingsSnapshot, TrackRef},
    lyrics::cache::LyricCache,
    player::{spotify_macos::SpotifyMacOsAdapter, PlayerAdapter},
    sync::compute_render,
};
use std::path::PathBuf;

/// Mutable, lock-protected runtime state. Does NOT hold the HTTP client
/// so commands can release this lock before awaiting network calls.
pub struct LyraRuntime {
    pub adapter: SpotifyMacOsAdapter,
    pub cache: LyricCache,
    config: ConfigStore,
    settings: SettingsSnapshot,
    current_doc: Option<LyricDocument>,
    last_track_key: Option<String>,
}

impl LyraRuntime {
    pub fn new() -> Self {
        let app_dir = app_support_dir();
        let config = ConfigStore::new(&app_dir);
        let settings = config.load();
        let cache = LyricCache::new(&app_dir);
        let _ = cache.ensure_dirs();

        Self {
            adapter: SpotifyMacOsAdapter::new(),
            cache,
            config,
            settings,
            current_doc: None,
            last_track_key: None,
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
        self.adapter.snapshot().and_then(|s| s.track)
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

    /// Poll + compute render snapshot. Call on every UI tick.
    pub fn tick(&mut self) -> RenderSnapshot {
        let _ = self.adapter.poll();
        let snapshot = self.adapter.snapshot().unwrap_or(PlaybackSnapshot {
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
            (Some(_), None) => LyricsStatus::Loading,
        };

        compute_render(snapshot, self.current_doc.as_ref(), status, above, below)
    }
}

fn app_support_dir() -> PathBuf {
    dirs_next::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("Lyra")
}
