//! Decides whether observed media is music and, for browsers, which service
//! is playing it. Pure: callers supply everything the transports exposed.
//!
//! Most transports report only the app (e.g. Chrome), not the page. The
//! service is known exactly only when a page URL or installed web-app ID is
//! available; otherwise YouTube is recognised from its upload conventions and
//! other services stay unnamed. Music vs non-music comes from a score over
//! title, channel, duration, album and artwork shape. Uncertain browser media
//! is resolved later by a lyric lookup (see `policy`).

use crate::domain::{IgnoreReason, MediaKind};

use super::metadata::same_name;

/// What a transport exposed about one track.
#[derive(Debug, Clone, Copy)]
pub struct MediaFacts<'a> {
    pub app_id: &'a str,
    pub from_browser: bool,
    /// Raw title, before video-title cleanup.
    pub title: &'a str,
    pub artist: &'a str,
    pub album: Option<&'a str>,
    pub duration_ms: u64,
    pub track_key: &'a str,
    pub page_url: Option<&'a str>,
    /// Artwork pixel size, when the artwork bytes were available.
    pub artwork_size: Option<(u32, u32)>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Classification {
    pub kind: MediaKind,
    pub platform: Option<Platform>,
    /// Why it is not music; set when `kind` is `NotMusic`.
    pub reason: Option<IgnoreReason>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Platform {
    YouTubeMusic,
    YouTube,
    Spotify,
    AppleMusic,
    SoundCloud,
    Deezer,
    Tidal,
    Bandcamp,
    AmazonMusic,
    Pandora,
    Audiomack,
    Netflix,
    PrimeVideo,
    DisneyPlus,
    Hulu,
    Max,
    Twitch,
    Vimeo,
}

impl Platform {
    pub fn name(self) -> &'static str {
        match self {
            Self::YouTubeMusic => "YouTube Music",
            Self::YouTube => "YouTube",
            Self::Spotify => "Spotify",
            Self::AppleMusic => "Apple Music",
            Self::SoundCloud => "SoundCloud",
            Self::Deezer => "Deezer",
            Self::Tidal => "TIDAL",
            Self::Bandcamp => "Bandcamp",
            Self::AmazonMusic => "Amazon Music",
            Self::Pandora => "Pandora",
            Self::Audiomack => "Audiomack",
            Self::Netflix => "Netflix",
            Self::PrimeVideo => "Prime Video",
            Self::DisneyPlus => "Disney+",
            Self::Hulu => "Hulu",
            Self::Max => "Max",
            Self::Twitch => "Twitch",
            Self::Vimeo => "Vimeo",
        }
    }

    fn is_music_service(self) -> bool {
        matches!(
            self,
            Self::YouTubeMusic
                | Self::Spotify
                | Self::AppleMusic
                | Self::SoundCloud
                | Self::Deezer
                | Self::Tidal
                | Self::Bandcamp
                | Self::AmazonMusic
                | Self::Pandora
                | Self::Audiomack
        )
    }

    /// Film, series and live-stream services: never music for Lyra.
    fn is_video_service(self) -> bool {
        matches!(
            self,
            Self::Netflix
                | Self::PrimeVideo
                | Self::DisneyPlus
                | Self::Hulu
                | Self::Max
                | Self::Twitch
        )
    }
}

/// Hosts (suffix match) to platforms. Order matters: `music.youtube.com`
/// before `youtube.com`.
const HOSTS: &[(&str, Platform)] = &[
    ("music.youtube.com", Platform::YouTubeMusic),
    ("youtube.com", Platform::YouTube),
    ("youtu.be", Platform::YouTube),
    ("open.spotify.com", Platform::Spotify),
    ("music.apple.com", Platform::AppleMusic),
    ("soundcloud.com", Platform::SoundCloud),
    ("deezer.com", Platform::Deezer),
    ("tidal.com", Platform::Tidal),
    ("bandcamp.com", Platform::Bandcamp),
    ("music.amazon.", Platform::AmazonMusic),
    ("pandora.com", Platform::Pandora),
    ("audiomack.com", Platform::Audiomack),
    ("netflix.com", Platform::Netflix),
    ("primevideo.com", Platform::PrimeVideo),
    ("disneyplus.com", Platform::DisneyPlus),
    ("hulu.com", Platform::Hulu),
    ("max.com", Platform::Max),
    ("twitch.tv", Platform::Twitch),
    ("vimeo.com", Platform::Vimeo),
];

/// Installed web apps (PWAs) report their own app ID. Lowercase substrings.
const WEB_APP_IDS: &[(&str, Platform)] = &[
    // Chrome's YouTube Music app ID.
    ("cinhimbnkkaeohfgghhklpknlkffjgod", Platform::YouTubeMusic),
    ("music.youtube.com", Platform::YouTubeMusic),
    ("open.spotify.com", Platform::Spotify),
];

/// Native apps whose media is music. Lowercase substrings of app IDs.
const MUSIC_APPS: &[&str] = &[
    "spotify",
    "com.apple.music",
    "applemusic",
    "itunes",
    "youtube-music",
    "youtubemusic",
    "cider",
    "tidal",
    "deezer",
    "amazon music",
    "amazonmusic",
    "foobar2000",
    "musicbee",
    "aimp",
    "winamp",
    "mediamonkey",
    "strawberry",
    "rhythmbox",
    "elisa",
    "amarok",
    "clementine",
    "audacious",
    "deadbeef",
    "lollypop",
    "quodlibet",
    "cmus",
    "mpd",
    "ncspot",
    "swinsian",
    "doppler",
    "vox",
    "plexamp",
];

/// Podcast apps: spoken word, never music.
const PODCAST_APPS: &[&str] = &[
    "com.apple.podcasts",
    "podcasts",
    "pocketcasts",
    "overcast",
    "castro",
    "gpodder",
    "kasts",
];

/// Title words that mark non-music videos and episodes. Lowercase.
const NON_MUSIC_WORDS: &[&str] = &[
    "podcast",
    "episode",
    " ep.",
    "trailer",
    "teaser",
    "gameplay",
    "walkthrough",
    "let's play",
    "tutorial",
    "how to",
    "review",
    "reaction",
    "reacts",
    "react to",
    "vlog",
    "interview",
    "news",
    "documentary",
    "highlights",
    "explained",
    "lecture",
    "unboxing",
    "#shorts",
    "#short",
    "livestream",
    "live stream",
    "full movie",
    "season ",
    "chapter ",
    "audiobook",
    "asmr",
    "sermon",
    "keynote",
    "webinar",
    "stand-up",
    "standup comedy",
];

/// Title words that mark music uploads (beyond the video-noise suffixes).
const MUSIC_WORDS: &[&str] = &[
    "feat.",
    "ft.",
    "(with ",
    "remix",
    "acoustic",
    "instrumental",
    "cover",
    "karaoke",
    "remaster",
    "official audio",
    "official video",
    "official music video",
    "lyric video",
    "lyrics",
    "visualizer",
    "visualiser",
    "live at",
    "unplugged",
];

/// Long-form music: mixes and albums run long without being videos.
const LONG_MUSIC_WORDS: &[&str] = &[
    "full album",
    "mix",
    "playlist",
    "dj set",
    "megamix",
    "medley",
    "radio",
    "beats to",
    "lofi",
    "lo-fi",
];

/// Opening words of question and challenge style video titles.
const VIDEO_TITLE_OPENERS: &[&str] = &[
    "how ",
    "why ",
    "what ",
    "when ",
    "who ",
    "i tried",
    "i spent",
    "i survived",
    "we tried",
    "top 10",
    "top 5",
];

/// Score at or above which media counts as music, and at or below which it
/// counts as not music. In between it is unsure.
const MUSIC_THRESHOLD: i32 = 3;
const NOT_MUSIC_THRESHOLD: i32 = -3;

pub fn classify(facts: &MediaFacts<'_>) -> Classification {
    let app = facts.app_id.to_lowercase();
    let title = facts.title.to_lowercase();

    if facts.track_key.starts_with("spotify:episode:") || contains_any(&app, PODCAST_APPS) {
        return not_music(None, IgnoreReason::Podcast);
    }

    let platform = facts
        .page_url
        .and_then(platform_from_url)
        .or_else(|| platform_from_web_app(&app));

    if let Some(p) = platform {
        if p.is_video_service() {
            return not_music(Some(p), IgnoreReason::VideoService);
        }
        if p.is_music_service() {
            // Music services also carry podcasts; everything else is music.
            return if mentions_podcast(&title) {
                not_music(Some(p), IgnoreReason::Podcast)
            } else {
                music(Some(p))
            };
        }
    }

    if !facts.from_browser && contains_any(&app, MUSIC_APPS) {
        return if mentions_podcast(&title) {
            not_music(None, IgnoreReason::Podcast)
        } else {
            music(None)
        };
    }

    let platform = platform
        .or_else(|| (facts.from_browser && looks_like_youtube(facts)).then_some(Platform::YouTube));
    let score = score(facts, &title);
    let kind = if score >= MUSIC_THRESHOLD {
        MediaKind::Music
    } else if score <= NOT_MUSIC_THRESHOLD {
        MediaKind::NotMusic
    } else {
        MediaKind::Unsure
    };
    Classification {
        kind,
        platform,
        reason: (kind == MediaKind::NotMusic).then_some(if mentions_podcast(&title) {
            IgnoreReason::Podcast
        } else {
            IgnoreReason::NotMusicSignals
        }),
    }
}

fn music(platform: Option<Platform>) -> Classification {
    Classification {
        kind: MediaKind::Music,
        platform,
        reason: None,
    }
}

fn not_music(platform: Option<Platform>, reason: IgnoreReason) -> Classification {
    Classification {
        kind: MediaKind::NotMusic,
        platform,
        reason: Some(reason),
    }
}

fn contains_any(haystack: &str, needles: &[&str]) -> bool {
    needles.iter().any(|needle| haystack.contains(needle))
}

fn mentions_podcast(lower_title: &str) -> bool {
    contains_any(lower_title, &["podcast", "episode", " ep."])
}

pub fn platform_from_url(url: &str) -> Option<Platform> {
    let rest = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))?;
    let host = rest.split(['/', '?', '#', ':']).next()?.to_lowercase();
    HOSTS
        .iter()
        .find(|(suffix, _)| {
            if suffix.ends_with('.') {
                host.starts_with(suffix) || host.contains(&format!(".{suffix}"))
            } else {
                host == *suffix || host.ends_with(&format!(".{suffix}"))
            }
        })
        .map(|(_, platform)| *platform)
}

fn platform_from_web_app(lower_app_id: &str) -> Option<Platform> {
    WEB_APP_IDS
        .iter()
        .find(|(needle, _)| lower_app_id.contains(needle))
        .map(|(_, platform)| *platform)
}

/// YouTube upload conventions that other music services do not use.
fn looks_like_youtube(facts: &MediaFacts<'_>) -> bool {
    let artist = facts.artist.trim();
    artist.ends_with(" - Topic")
        || artist.ends_with("VEVO")
        || has_video_noise(&facts.title.to_lowercase())
        || artist_dash_title(facts).is_some()
}

fn has_video_noise(lower_title: &str) -> bool {
    [
        "(official video)",
        "(official music video)",
        "(official audio)",
        "(official lyric video)",
        "(lyric video)",
        "(lyrics)",
        "(visualizer)",
        "[official video]",
        "[official music video]",
        "[official audio]",
        "[lyrics]",
    ]
    .iter()
    .any(|noise| lower_title.contains(noise))
}

/// "Artist - Title" where the left part names the channel/artist.
fn artist_dash_title<'a>(facts: &MediaFacts<'a>) -> Option<&'a str> {
    let channel = facts
        .artist
        .trim()
        .trim_end_matches(" - Topic")
        .trim_end_matches("VEVO");
    for separator in [" - ", " – ", " — "] {
        if let Some((left, right)) = facts.title.split_once(separator) {
            if !right.trim().is_empty() && same_name(left.trim(), channel) {
                return Some(right.trim());
            }
        }
    }
    None
}

fn score(facts: &MediaFacts<'_>, title: &str) -> i32 {
    let artist = facts.artist.trim();
    let duration_s = facts.duration_ms / 1000;
    let long_music = contains_any(title, LONG_MUSIC_WORDS);
    let mut score = 0;

    // Music signals.
    if artist.ends_with(" - Topic") || artist.ends_with("VEVO") {
        score += 3;
    }
    if has_video_noise(title) {
        score += 3;
    }
    if artist_dash_title(facts).is_some() {
        score += 2;
    }
    if facts.album.is_some_and(|a| !a.trim().is_empty()) {
        score += 2;
    }
    if contains_any(title, MUSIC_WORDS) {
        score += 1;
    }
    if long_music {
        score += 1;
    }
    if facts
        .artwork_size
        .is_some_and(|(w, h)| h > 0 && (w as f64 / h as f64 - 1.0).abs() < 0.05)
    {
        score += 1;
    }
    if (90..=480).contains(&duration_s) {
        score += 1;
    }

    // Non-music signals.
    if contains_any(title, NON_MUSIC_WORDS) {
        score -= 3;
    }
    if !long_music && facts.album.is_none_or(|a| a.trim().is_empty()) {
        if duration_s > 20 * 60 {
            score -= 3;
        } else if duration_s > 12 * 60 {
            score -= 1;
        }
    }
    if duration_s > 0 && duration_s < 45 {
        score -= 2;
    }
    if artist.is_empty() {
        score -= 2;
    }
    if facts.title.contains(" | ") || facts.title.chars().count() > 80 {
        score -= 1;
    }
    if facts.title.trim_end().ends_with('?')
        || VIDEO_TITLE_OPENERS
            .iter()
            .any(|opener| title.starts_with(opener))
    {
        score -= 1;
    }
    score
}

/// Pixel size from PNG, JPEG, GIF or WebP header bytes.
pub fn image_size(data: &[u8]) -> Option<(u32, u32)> {
    let be16 = |b: &[u8]| u32::from(u16::from_be_bytes([b[0], b[1]]));
    let le16 = |b: &[u8]| u32::from(u16::from_le_bytes([b[0], b[1]]));
    if data.len() >= 24 && data.starts_with(&[0x89, b'P', b'N', b'G']) {
        let w = u32::from_be_bytes([data[16], data[17], data[18], data[19]]);
        let h = u32::from_be_bytes([data[20], data[21], data[22], data[23]]);
        return Some((w, h));
    }
    if data.len() >= 10 && data.starts_with(b"GIF8") {
        return Some((le16(&data[6..8]), le16(&data[8..10])));
    }
    if data.len() >= 30 && &data[0..4] == b"RIFF" && &data[8..12] == b"WEBP" {
        return match &data[12..16] {
            b"VP8X" => {
                let w = 1
                    + (u32::from(data[24]) | u32::from(data[25]) << 8 | u32::from(data[26]) << 16);
                let h = 1
                    + (u32::from(data[27]) | u32::from(data[28]) << 8 | u32::from(data[29]) << 16);
                Some((w, h))
            }
            b"VP8 " => Some((le16(&data[26..28]) & 0x3fff, le16(&data[28..30]) & 0x3fff)),
            _ => None,
        };
    }
    if data.starts_with(&[0xFF, 0xD8]) {
        let mut i = 2;
        while i + 9 < data.len() {
            if data[i] != 0xFF {
                return None;
            }
            let marker = data[i + 1];
            let len = be16(&data[i + 2..i + 4]) as usize;
            if (0xC0..=0xCF).contains(&marker) && !matches!(marker, 0xC4 | 0xC8 | 0xCC) {
                return Some((be16(&data[i + 7..i + 9]), be16(&data[i + 5..i + 7])));
            }
            i += 2 + len;
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn facts<'a>(app: &'a str, title: &'a str, artist: &'a str, duration_s: u64) -> MediaFacts<'a> {
        MediaFacts {
            app_id: app,
            from_browser: super::super::metadata::is_browser(app),
            title,
            artist,
            album: None,
            duration_ms: duration_s * 1000,
            track_key: "meta::x",
            page_url: None,
            artwork_size: None,
        }
    }

    const CHROME: &str = "com.google.Chrome";

    #[test]
    fn youtube_music_uploads_are_music_and_recognised_as_youtube() {
        let c = classify(&facts(
            CHROME,
            "ROSALÍA - DIVINIZE (Official Video)",
            "ROSALIAVEVO",
            262,
        ));
        assert_eq!(c.kind, MediaKind::Music);
        assert_eq!(c.platform, Some(Platform::YouTube));

        let topic = classify(&facts(CHROME, "Divinize", "ROSALÍA - Topic", 247));
        assert_eq!(topic.kind, MediaKind::Music);
        assert_eq!(topic.platform, Some(Platform::YouTube));
    }

    #[test]
    fn clean_song_metadata_without_signals_is_unsure() {
        // YouTube Music in a browser reports just title and artist.
        let c = classify(&facts(CHROME, "Divinize", "ROSALÍA", 247));
        assert_eq!(c.kind, MediaKind::Unsure);
        assert_eq!(c.platform, None);
        // An album tips it to music.
        let mut with_album = facts(CHROME, "Divinize", "ROSALÍA", 247);
        with_album.album = Some("LUX");
        assert_eq!(classify(&with_album).kind, MediaKind::Music);
    }

    #[test]
    fn non_music_videos_are_not_music() {
        for (title, artist, secs) in [
            ("I Survived 100 Days in the Wilderness", "MrBeast", 1_500),
            ("The Daily Show Podcast Episode 12", "Comedy Central", 2_400),
            ("Elden Ring Gameplay Walkthrough Part 3", "Gamer", 3_600),
            ("iPhone 18 Review | Is it worth it?", "Tech Channel", 900),
        ] {
            let c = classify(&facts(CHROME, title, artist, secs));
            assert_eq!(c.kind, MediaKind::NotMusic, "{title}");
        }
    }

    #[test]
    fn long_mixes_are_not_penalised_for_length() {
        let c = classify(&facts(
            CHROME,
            "Deep House Mix 2026 (Official Audio)",
            "DJ Someone",
            3_600,
        ));
        assert_eq!(c.kind, MediaKind::Music);
    }

    #[test]
    fn page_urls_name_the_service() {
        let mut f = facts(CHROME, "Divinize", "ROSALÍA", 247);
        f.page_url = Some("https://music.youtube.com/watch?v=abc");
        let c = classify(&f);
        assert_eq!(c.kind, MediaKind::Music);
        assert_eq!(c.platform, Some(Platform::YouTubeMusic));

        f.page_url = Some("https://www.netflix.com/watch/1");
        let c = classify(&f);
        assert_eq!(c.kind, MediaKind::NotMusic);
        assert_eq!(c.reason, Some(IgnoreReason::VideoService));

        assert_eq!(
            platform_from_url("https://www.youtube.com/watch?v=x"),
            Some(Platform::YouTube)
        );
        assert_eq!(
            platform_from_url("https://music.amazon.co.uk/x"),
            Some(Platform::AmazonMusic)
        );
        assert_eq!(platform_from_url("https://notyoutube.com/"), None);
    }

    #[test]
    fn native_apps_and_podcasts() {
        assert_eq!(
            classify(&facts("com.spotify.client", "Anything", "", 30)).kind,
            MediaKind::Music
        );
        let mut episode = facts("com.spotify.client", "Ep 1", "Show", 3_000);
        episode.track_key = "spotify:episode:abc";
        assert_eq!(classify(&episode).reason, Some(IgnoreReason::Podcast));
        assert_eq!(
            classify(&facts("com.apple.podcasts", "News", "NPR", 1_200)).reason,
            Some(IgnoreReason::Podcast)
        );
        // A film in a video player is not music.
        assert_eq!(
            classify(&facts("com.colliderli.iina", "Movie.2026.1080p", "", 7_200)).kind,
            MediaKind::NotMusic
        );
        // A tagged song in a video player is unsure (followed for native apps).
        assert_eq!(
            classify(&facts("org.videolan.vlc", "Song", "Artist", 200)).kind,
            MediaKind::Unsure
        );
    }

    #[test]
    fn square_artwork_counts_toward_music() {
        let mut f = facts(CHROME, "Divinize", "ROSALÍA", 247);
        f.artwork_size = Some((544, 544));
        let base = score(&facts(CHROME, "Divinize", "ROSALÍA", 247), "divinize");
        assert_eq!(score(&f, "divinize"), base + 1);
    }

    #[test]
    fn image_headers_report_size() {
        let mut png = vec![0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13];
        png.extend_from_slice(b"IHDR");
        png.extend_from_slice(&544u32.to_be_bytes());
        png.extend_from_slice(&306u32.to_be_bytes());
        assert_eq!(image_size(&png), Some((544, 306)));

        // SOI, APP0 (len 4), SOF0 with height 84, width 150.
        let jpeg = [
            0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x04, 0x00, 0x00, 0xFF, 0xC0, 0x00, 0x11, 0x08, 0x00, 84,
            0x00, 150, 0x03,
        ];
        assert_eq!(image_size(&jpeg), Some((150, 84)));
        assert_eq!(image_size(b"nope"), None);
    }
}
