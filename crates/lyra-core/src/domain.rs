use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum PlayerSource {
    SpotifyMacOs,
    AppleMusicMacOs,
    WindowsSmtc,
    LinuxMpris,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrackRef {
    pub source: PlayerSource,
    pub uri: String,
    pub title: String,
    pub artist: String,
    pub album: Option<String>,
    pub duration_ms: u64,
    pub artwork_url: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum PlaybackState {
    Playing,
    Paused,
    Stopped,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlaybackSnapshot {
    pub track: Option<TrackRef>,
    pub state: PlaybackState,
    pub position_ms: Option<u64>,
    /// Wall-clock ms when this snapshot was observed.
    pub observed_at_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LyricWord {
    pub start_ms: u64,
    pub end_ms: u64,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LyricLine {
    pub start_ms: u64,
    pub end_ms: Option<u64>,
    pub text: String,
    /// Per-word timing parsed from enhanced LRC (`<mm:ss.xx>` markers).
    /// `None` means the line had no inline word markers — sync engine will
    /// interpolate from line bounds + character count.
    #[serde(default)]
    pub words: Option<Vec<LyricWord>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum LyricSourceKind {
    Lrclib,
    ManualOverride,
    NegativeCache,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LyricDocument {
    pub track_key: String,
    pub source: LyricSourceKind,
    pub lines: Vec<LyricLine>,
    pub raw_lrc: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VisibleLine {
    pub index: usize,
    pub text: String,
    pub is_active: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum NotFoundReason {
    /// Provider confirmed it has no lyrics for this track.
    Miss,
    /// Network/IO failure prevented the lookup. Retryable.
    NetworkError,
    /// Provider rate-limited the request. Retryable after backoff.
    RateLimit,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum LyricsStatus {
    Loading,
    Ready,
    NotFound { reason: NotFoundReason },
    Error(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RenderSnapshot {
    pub playback: PlaybackSnapshot,
    pub lyrics_status: LyricsStatus,
    pub active_line_index: Option<usize>,
    /// 0.0–1.0 progress within the active line (for karaoke).
    pub line_progress: Option<f32>,
    pub visible_lines: Vec<VisibleLine>,
    /// Word-level timing for the active line. Either parsed from enhanced LRC
    /// or interpolated from line bounds and character distribution.
    /// `None` when no active line or line has no end_ms.
    #[serde(default)]
    pub active_line_words: Option<Vec<LyricWord>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindowSettings {
    pub x: Option<i32>,
    pub y: Option<i32>,
    pub width: u32,
    pub height: u32,
    pub always_on_top: bool,
    pub click_through: bool,
    pub hide_when_idle: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppearanceSettings {
    pub font_family: String,
    pub font_size: u32,
    pub text_color: String,
    pub background_opacity: f32,
    pub context_lines_above: u32,
    pub context_lines_below: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BehaviorSettings {
    pub karaoke_mode: bool,
    pub poll_interval_ms: u64,
    #[serde(default)]
    pub hide_when_paused: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SettingsSnapshot {
    pub window: WindowSettings,
    pub appearance: AppearanceSettings,
    pub behavior: BehaviorSettings,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload")]
pub enum UiIntent {
    SetClickThrough(bool),
    UpdateSettings(SettingsPatch),
    RefreshLyrics,
    ImportOverride { track_key: String, file_path: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SettingsPatch {
    pub window: Option<WindowSettings>,
    pub appearance: Option<AppearanceSettings>,
    pub behavior: Option<BehaviorSettings>,
}

impl Default for WindowSettings {
    fn default() -> Self {
        Self {
            x: None,
            y: None,
            width: 400,
            height: 200,
            always_on_top: true,
            click_through: false,
            hide_when_idle: true,
        }
    }
}

impl Default for AppearanceSettings {
    fn default() -> Self {
        Self {
            font_family: "System".to_string(),
            font_size: 16,
            text_color: "#ffffff".to_string(),
            background_opacity: 0.6,
            context_lines_above: 1,
            context_lines_below: 1,
        }
    }
}

impl Default for BehaviorSettings {
    fn default() -> Self {
        Self {
            karaoke_mode: false,
            poll_interval_ms: 300,
            hide_when_paused: false,
        }
    }
}

impl Default for SettingsSnapshot {
    fn default() -> Self {
        Self {
            window: WindowSettings::default(),
            appearance: AppearanceSettings::default(),
            behavior: BehaviorSettings::default(),
        }
    }
}
