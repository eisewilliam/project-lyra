//! Player-independent track metadata rules: cache keys for players without a
//! native track ID, browser detection, app display names, and cleanup of
//! video-site titles. Pure functions; every adapter shares them.

/// Cache and offset key for a track without a native ID. Duration (rounded
/// to seconds) separates versions that share a title, such as a music video
/// with an intro and the album cut.
pub fn metadata_key(artist: &str, title: &str, duration_ms: u64) -> String {
    format!(
        "meta::{}::{}::{}",
        urlencoding::encode(&artist.trim().to_lowercase()),
        urlencoding::encode(&title.trim().to_lowercase()),
        (duration_ms + 500) / 1000
    )
}

/// Substrings of bundle IDs (macOS), AUMIDs (Windows) and MPRIS bus names
/// (Linux) that identify web browsers. Lowercase.
const BROWSER_IDS: &[&str] = &[
    "chrome",
    "chromium",
    "safari",
    "com.apple.webkit",
    "thebrowser", // Arc
    "edgemac",
    "msedge",
    "microsoft-edge",
    "firefox",
    "308046b0af4a39cb", // Firefox's AUMID on Windows
    "brave",
    "opera",
    "vivaldi",
    "zen-browser",
    "plasma-browser-integration",
];

/// True when the playing app is a web browser. Browser media can be any
/// video or page, so lyric lookups for it need the user's consent.
pub fn is_browser(app_id: &str) -> bool {
    let id = app_id.to_lowercase();
    BROWSER_IDS.iter().any(|needle| id.contains(needle))
}

/// Known app identifiers (lowercase substrings) and their display names.
/// Order matters: the first match wins.
const APP_NAMES: &[(&str, &str)] = &[
    // Installed web apps report their own bundle ID; name them by service.
    ("cinhimbnkkaeohfgghhklpknlkffjgod", "YouTube Music"),
    ("com.google.chrome.app.", "Chrome web app"),
    ("spotify", "Spotify"),
    ("com.apple.music", "Apple Music"),
    ("applemusic", "Apple Music"),
    ("itunes", "iTunes"),
    ("youtube-music", "YouTube Music"),
    ("youtubemusic", "YouTube Music"),
    ("cider", "Cider"),
    ("com.google.chrome", "Google Chrome"),
    ("chromium", "Chromium"),
    ("chrome", "Google Chrome"),
    ("com.apple.safari", "Safari"),
    ("com.apple.webkit", "Safari"),
    ("thebrowser", "Arc"),
    ("edge", "Microsoft Edge"),
    ("firefox", "Firefox"),
    ("308046b0af4a39cb", "Firefox"),
    ("brave", "Brave"),
    ("opera", "Opera"),
    ("vivaldi", "Vivaldi"),
    ("zen-browser", "Zen"),
    ("iina", "IINA"),
    ("vlc", "VLC"),
    ("foobar2000", "foobar2000"),
    ("musicbee", "MusicBee"),
    ("strawberry", "Strawberry"),
    ("rhythmbox", "Rhythmbox"),
    ("elisa", "Elisa"),
    ("tidal", "TIDAL"),
    ("deezer", "Deezer"),
];

/// Human-readable app name for an app identifier from any transport.
pub fn display_name(app_id: &str) -> String {
    let id = app_id.to_lowercase();
    if let Some((_, name)) = APP_NAMES.iter().find(|(needle, _)| id.contains(needle)) {
        return (*name).to_string();
    }
    // Fallback: the most specific segment of the identifier, e.g.
    // `org.example.Player` → `Player`, `Player.exe` → `Player`,
    // `player.instance42` → `player`.
    let trimmed = app_id
        .split('!')
        .next()
        .unwrap_or(app_id)
        .trim_end_matches(".exe")
        .trim_end_matches(".EXE");
    let segment = if trimmed.contains(".instance") {
        trimmed.split('.').next()
    } else {
        trimmed.rsplit('.').next()
    }
    .unwrap_or(trimmed);
    let mut chars = segment.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().chain(chars).collect(),
        None => app_id.to_string(),
    }
}

/// Ads reported as tracks by some players. Never fetch lyrics for them.
pub fn is_advertisement(title: &str, artist: &str) -> bool {
    let is_ad = |s: &str| {
        let s = s.trim().to_lowercase();
        s == "advertisement" || s == "advertising"
    };
    is_ad(title) || is_ad(artist)
}

/// Bracketed title suffixes that describe a video upload, not the song.
const VIDEO_NOISE: &[&str] = &[
    "official music video",
    "official lyric video",
    "official video",
    "official audio",
    "official visualizer",
    "official visualiser",
    "lyric video",
    "lyrics video",
    "lyrics",
    "lyric",
    "audio",
    "visualizer",
    "visualiser",
    "music video",
    "video",
    "official",
    "hd",
    "hq",
    "4k",
    "mv",
    "m/v",
];

/// Clean metadata that a browser reports for a video upload. YouTube Music
/// publishes proper title/artist and passes through unchanged; plain YouTube
/// reports the video title and channel, e.g. "The Weeknd - Blinding Lights
/// (Official Video)" by "TheWeekndVEVO".
pub fn clean_video_metadata(title: &str, artist: &str) -> (String, String) {
    let channel = clean_channel(artist);
    let title = strip_video_noise(title);

    for separator in [" - ", " – ", " — "] {
        let mut parts = title.splitn(2, separator);
        let (Some(left), Some(right)) = (parts.next(), parts.next()) else {
            continue;
        };
        let (left, right) = (left.trim(), right.trim());
        if left.is_empty() || right.is_empty() {
            continue;
        }
        if channel.is_empty() || same_name(left, &channel) || artist.ends_with("VEVO") {
            return (right.to_string(), left.to_string());
        }
    }
    (title, channel)
}

fn clean_channel(artist: &str) -> String {
    let artist = artist.trim();
    let artist = artist.strip_suffix(" - Topic").unwrap_or(artist);
    let artist = artist.strip_suffix("VEVO").unwrap_or(artist);
    artist.trim().to_string()
}

/// "TheWeeknd" and "The Weeknd" name the same artist.
pub(crate) fn same_name(a: &str, b: &str) -> bool {
    let squash = |s: &str| -> String {
        s.chars()
            .filter(|c| c.is_alphanumeric())
            .flat_map(char::to_lowercase)
            .collect()
    };
    let (a, b) = (squash(a), squash(b));
    let (shorter, longer) = if a.len() <= b.len() {
        (&a, &b)
    } else {
        (&b, &a)
    };
    // Containment only for names long enough not to match by accident.
    !shorter.is_empty() && (a == b || (shorter.len() >= 4 && longer.contains(shorter.as_str())))
}

fn strip_video_noise(title: &str) -> String {
    let mut out = title.trim().to_string();
    while let Some((open, close)) = trailing_group(&out) {
        let inner = out[open + 1..close].trim().to_lowercase();
        if !VIDEO_NOISE.iter().any(|noise| inner == *noise) {
            break;
        }
        out = out[..open].trim_end().to_string();
    }
    out
}

/// Byte range of a trailing `(...)` or `[...]` group.
fn trailing_group(s: &str) -> Option<(usize, usize)> {
    let close = s.len().checked_sub(1)?;
    let open_char = match s.as_bytes()[close] {
        b')' => '(',
        b']' => '[',
        _ => return None,
    };
    let open = s[..close].rfind(open_char)?;
    Some((open, close))
}

/// When an adapter that caches metadata per track should read it again.
///
/// Players swap the track ID and title first on a change and fill in duration
/// and artwork once the item has loaded: Spotify music videos read
/// `duration = 0` for 1–2 s. Adapters that read metadata once per track would
/// otherwise keep a partial or stale first read for the whole track. The first
/// read is repeated once after `SETTLE_MS`, and retried while incomplete.
#[derive(Debug, Clone, Copy)]
pub struct MetaRefresh {
    first_ms: u64,
    last_ms: u64,
    settled: bool,
}

impl MetaRefresh {
    pub const SETTLE_MS: u64 = 2_000;
    const RETRY_FAST_MS: u64 = 500;
    const RETRY_SLOW_MS: u64 = 5_000;
    /// After this, the missing fields are probably absent (a local file
    /// without artwork), so retries slow down.
    const FAST_WINDOW_MS: u64 = 10_000;

    /// Start tracking a track whose metadata was first read at `now_ms`.
    pub fn new(now_ms: u64) -> Self {
        Self {
            first_ms: now_ms,
            last_ms: now_ms,
            settled: false,
        }
    }

    /// `complete` is whether the cached read has every field the player
    /// eventually provides (typically a duration and artwork).
    pub fn due(&self, now_ms: u64, complete: bool) -> bool {
        let since_first = now_ms.saturating_sub(self.first_ms);
        if !self.settled && since_first >= Self::SETTLE_MS {
            return true;
        }
        if complete {
            return false;
        }
        let retry_ms = if since_first < Self::FAST_WINDOW_MS {
            Self::RETRY_FAST_MS
        } else {
            Self::RETRY_SLOW_MS
        };
        now_ms.saturating_sub(self.last_ms) >= retry_ms
    }

    /// Record a re-read at `now_ms`, successful or not, so a failing read
    /// waits a retry interval instead of running on every poll.
    pub fn reread(&mut self, now_ms: u64) {
        self.last_ms = now_ms;
        self.settled |= now_ms.saturating_sub(self.first_ms) >= Self::SETTLE_MS;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn complete_metadata_is_reread_once_after_settling() {
        let mut refresh = MetaRefresh::new(1_000);
        assert!(!refresh.due(1_000 + MetaRefresh::SETTLE_MS - 1, true));
        assert!(refresh.due(1_000 + MetaRefresh::SETTLE_MS, true));
        refresh.reread(1_000 + MetaRefresh::SETTLE_MS);
        assert!(!refresh.due(61_000, true));
    }

    #[test]
    fn missing_duration_is_retried_until_filled() {
        // Spotify music videos report duration 0 right after a track change.
        let mut refresh = MetaRefresh::new(1_000);
        assert!(!refresh.due(1_499, false));
        assert!(refresh.due(1_500, false));
        refresh.reread(1_500);
        assert!(!refresh.due(1_999, false));
        assert!(refresh.due(2_000, false));
    }

    #[test]
    fn persistently_incomplete_metadata_backs_off() {
        let mut refresh = MetaRefresh::new(0);
        refresh.reread(10_000);
        assert!(!refresh.due(10_500, false));
        assert!(refresh.due(15_000, false));
    }

    #[test]
    fn metadata_key_separates_versions_by_duration() {
        let album = metadata_key("The Weeknd", "Blinding Lights", 200_040);
        let video = metadata_key("The Weeknd", "Blinding Lights", 262_000);
        assert_eq!(album, "meta::the%20weeknd::blinding%20lights::200");
        assert_ne!(album, video);
        assert_eq!(
            album,
            metadata_key(" the weeknd ", "BLINDING LIGHTS", 199_600)
        );
    }

    #[test]
    fn browsers_are_recognized_on_every_transport() {
        for id in [
            "com.google.Chrome",
            "com.apple.Safari",
            "company.thebrowser.Browser",
            "org.mozilla.firefox",
            "Chrome",
            "MSEdge",
            "308046B0AF4A39CB",
            "org.mpris.MediaPlayer2.chromium.instance1234",
            "firefox.instance_1_42",
        ] {
            assert!(is_browser(id), "{id}");
        }
        for id in [
            "com.spotify.client",
            "com.apple.Music",
            "Spotify.exe",
            "vlc",
        ] {
            assert!(!is_browser(id), "{id}");
        }
    }

    #[test]
    fn display_names_cover_known_and_unknown_apps() {
        assert_eq!(display_name("com.apple.Music"), "Apple Music");
        assert_eq!(
            display_name("AppleInc.AppleMusicWin_nzyj5cx40ttqa!App"),
            "Apple Music"
        );
        assert_eq!(display_name("Spotify.exe"), "Spotify");
        assert_eq!(display_name("com.google.Chrome"), "Google Chrome");
        assert_eq!(
            display_name("com.google.Chrome.app.cinhimbnkkaeohfgghhklpknlkffjgod"),
            "YouTube Music"
        );
        assert_eq!(
            display_name("com.google.Chrome.app.abcdef"),
            "Chrome web app"
        );
        assert_eq!(display_name("MSEdge"), "Microsoft Edge");
        assert_eq!(display_name("org.example.Player"), "Player");
        assert_eq!(display_name("Amarok.exe"), "Amarok");
        assert_eq!(display_name("amarok.instance42"), "Amarok");
    }

    #[test]
    fn youtube_uploads_are_split_and_cleaned() {
        assert_eq!(
            clean_video_metadata(
                "The Weeknd - Blinding Lights (Official Video)",
                "TheWeekndVEVO"
            ),
            ("Blinding Lights".into(), "The Weeknd".into())
        );
        assert_eq!(
            clean_video_metadata("Adele - Hello [Official Music Video] (HD)", "Adele"),
            ("Hello".into(), "Adele".into())
        );
        assert_eq!(
            clean_video_metadata("Blinding Lights", "The Weeknd - Topic"),
            ("Blinding Lights".into(), "The Weeknd".into())
        );
    }

    #[test]
    fn youtube_music_metadata_passes_through() {
        assert_eq!(
            clean_video_metadata("Save Your Tears (Remix)", "The Weeknd & Ariana Grande"),
            (
                "Save Your Tears (Remix)".into(),
                "The Weeknd & Ariana Grande".into()
            )
        );
        // A hyphenated title by a different channel is not split.
        assert_eq!(
            clean_video_metadata("Back to Black - Live", "Some Concert Channel"),
            ("Back to Black - Live".into(), "Some Concert Channel".into())
        );
    }

    #[test]
    fn advertisements_are_detected() {
        assert!(is_advertisement("Advertisement", ""));
        assert!(is_advertisement("Spotify", "advertisement"));
        assert!(!is_advertisement("Blinding Lights", "The Weeknd"));
    }
}
