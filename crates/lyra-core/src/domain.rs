use serde::{Deserialize, Serialize};

/// OS mechanism an adapter uses to observe a player. One player can be seen
/// through more than one transport (e.g. Spotify via AppleScript and
/// MediaRemote); the transport is not the player.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Transport {
    AppleScript,
    MediaRemote,
    Smtc,
    Mpris,
}

/// The application producing playback. `id` is the most stable identifier the
/// transport exposes: bundle ID (macOS), AUMID (Windows) or MPRIS bus-name
/// suffix (Linux).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlayerApp {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrackRef {
    pub player: PlayerApp,
    pub transport: Transport,
    /// Canonical track key used for the lyric cache and offsets. Prefer a
    /// native ID; otherwise a stable metadata-derived key.
    pub uri: String,
    /// Player-native identifier (e.g. `spotify:track:…`) when the transport
    /// exposes one.
    pub native_id: Option<String>,
    /// Local audio file backing the track, when the transport exposes it.
    /// Never sent to lyric providers or serialized to the webview.
    #[serde(skip)]
    pub file_path: Option<String>,
    /// Playing in a web browser. Browser media can be any video or page, so
    /// lyric lookups for it require the user's consent.
    pub from_browser: bool,
    /// Service inside the app, when known or recognisable (e.g. "YouTube"
    /// playing in a browser).
    pub platform: Option<String>,
    /// Whether this is music; Lyra follows only music unless overridden.
    pub kind: MediaKind,
    /// Page the media plays on, when the transport exposes it. Used only to
    /// recognise the platform; never serialized or sent anywhere.
    #[serde(skip)]
    pub page_url: Option<String>,
    pub title: String,
    pub artist: String,
    pub album: Option<String>,
    pub duration_ms: u64,
    pub artwork_url: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum MediaKind {
    Music,
    NotMusic,
    /// No clear signal either way; resolved by a lyric lookup or the user.
    Unsure,
}

/// Why Lyra is not following a playing session.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum IgnoreReason {
    /// A podcast or other spoken-word episode.
    Podcast,
    /// A film, series or live-stream service.
    VideoService,
    /// Title, duration or channel look like a non-music video.
    NotMusicSignals,
    /// Nothing marks it as music and LRCLIB has no lyrics for it.
    NoLyricsFound,
    /// Lyra is checking LRCLIB to decide whether it is music.
    Checking,
    /// Nothing marks it as music, and lookups for browser media are off.
    Unconfirmed,
    /// The user chose never to follow this app.
    AppRule,
    /// The user marked this media as not music.
    MarkedNotMusic,
    /// The user chose to follow a different player only.
    OtherPlayerSelected,
}

/// Media that is playing but not followed, so surfaces can explain why and
/// offer an override.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct IgnoredMedia {
    pub track_key: String,
    pub title: String,
    pub artist: String,
    pub player: PlayerApp,
    pub platform: Option<String>,
    pub reason: IgnoreReason,
}

/// Per-app following rule set by the user.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum FollowRule {
    /// Follow music, ignore other media (the default).
    #[default]
    Auto,
    Always,
    Never,
}

/// User-facing media-following settings.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MediaPolicyView {
    /// Follow only this app, turning off automatic player selection.
    /// `None` selects automatically.
    pub pinned_app: Option<PlayerApp>,
    /// Ignore media that is not music (default on).
    pub only_music: bool,
    /// Rules by app ID; apps without an entry use `FollowRule::Auto`.
    pub app_rules: std::collections::BTreeMap<String, FollowRule>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum PlaybackState {
    Playing,
    Paused,
    Stopped,
}

/// How trustworthy `PlaybackSnapshot::position_ms` is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PositionQuality {
    /// Read from the player at observation time.
    Exact,
    /// Projected from a player-supplied position and timestamp.
    Extrapolated,
    /// The player does not report a usable position.
    Missing,
}

/// Controls the observed player accepts. Surfaces must hide or disable
/// controls that are not supported instead of failing silently.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlaybackCaps {
    pub play_pause: bool,
    pub next: bool,
    pub previous: bool,
    pub seek: bool,
    /// Lyra can bring the player to the front, showing the track.
    pub raise: bool,
}

impl PlaybackCaps {
    pub const ALL: Self = Self {
        play_pause: true,
        next: true,
        previous: true,
        seek: true,
        raise: true,
    };

    pub const NONE: Self = Self {
        play_pause: false,
        next: false,
        previous: false,
        seek: false,
        raise: false,
    };
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlaybackSnapshot {
    pub track: Option<TrackRef>,
    pub state: PlaybackState,
    pub position_ms: Option<u64>,
    /// Wall-clock ms when this snapshot was observed.
    pub observed_at_ms: u64,
    /// Playback speed multiplier; 1.0 is normal speed.
    pub rate: f64,
    pub position_quality: PositionQuality,
    pub caps: PlaybackCaps,
    /// Playing media Lyra chose not to follow, when nothing is followed.
    pub ignored: Option<IgnoredMedia>,
}

/// A player Lyra has seen, with the user's settings for it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct KnownPlayerInfo {
    pub app: PlayerApp,
    pub transport: Transport,
    pub last_seen_ms: u64,
    /// Reporting a playback session right now.
    pub running: bool,
    pub rule: FollowRule,
    /// Lyra is set to follow only this player.
    pub pinned: bool,
}

/// Diagnostics view of one observed playback session.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayerSessionInfo {
    /// Internal routing key; not for display.
    pub id: String,
    pub player: Option<PlayerApp>,
    pub transport: Transport,
    pub state: PlaybackState,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub platform: Option<String>,
    pub kind: Option<MediaKind>,
    /// Track key for per-track overrides.
    pub track_key: Option<String>,
    /// Set when Lyra is not following this session.
    pub ignored: Option<IgnoreReason>,
    /// The user's per-track override: `Some(true)` = music.
    pub marked_music: Option<bool>,
    pub app_rule: FollowRule,
    pub position_quality: PositionQuality,
    pub caps: PlaybackCaps,
    pub os_current: bool,
    pub active: bool,
}

#[cfg(test)]
impl TrackRef {
    /// Spotify-like track for unit tests; override fields with struct update
    /// syntax.
    pub(crate) fn fixture(uri: &str) -> Self {
        Self {
            player: PlayerApp {
                id: "com.spotify.client".into(),
                name: "Spotify".into(),
            },
            transport: Transport::AppleScript,
            uri: uri.into(),
            native_id: Some(uri.into()),
            file_path: None,
            from_browser: false,
            platform: None,
            kind: MediaKind::Music,
            page_url: None,
            title: "title".into(),
            artist: "artist".into(),
            album: None,
            duration_ms: 180_000,
            artwork_url: None,
        }
    }
}

impl PlaybackSnapshot {
    /// No active track. Used when nothing is playing or no player is reachable.
    pub fn stopped(observed_at_ms: u64) -> Self {
        Self {
            track: None,
            state: PlaybackState::Stopped,
            position_ms: None,
            observed_at_ms,
            rate: 1.0,
            position_quality: PositionQuality::Missing,
            caps: PlaybackCaps::NONE,
            ignored: None,
        }
    }
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
    /// Untimed provider text; never converted into synthetic timestamps.
    #[serde(default)]
    pub plain_lyrics: Option<String>,
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
    /// Browser media; the user has not decided whether Lyra may look up
    /// lyrics for it. The main window asks.
    ConsentRequired,
    /// Browser media; the user turned lyric lookups for it off.
    LookupDisabled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum LyricsStatus {
    Loading,
    Ready,
    Unsynced,
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
    /// Whether lyrics may be looked up for media playing in a web browser.
    /// Lookups send the title and artist to the lyric provider, and browser
    /// media can be any video or page.
    #[serde(default)]
    pub browser_lyrics: BrowserLyrics,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum BrowserLyrics {
    /// Ask once, in the main window, the first time browser media plays.
    #[default]
    Ask,
    Allow,
    Deny,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
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
    ImportOverride {
        track_key: String,
        file_path: String,
    },
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
            // Conservative defaults for the main window: these now drive real
            // behaviour (previously inert), so default to "don't pin / don't
            // auto-hide" and let the user opt in via Settings.
            always_on_top: false,
            click_through: false,
            hide_when_idle: false,
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
            browser_lyrics: BrowserLyrics::Ask,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_saved_before_browser_consent_still_load() {
        let json = r#"{"karaoke_mode":false,"poll_interval_ms":300,"hide_when_paused":true}"#;
        let behavior: BehaviorSettings = serde_json::from_str(json).unwrap();
        assert_eq!(behavior.browser_lyrics, BrowserLyrics::Ask);
        assert!(behavior.hide_when_paused);
    }
}
