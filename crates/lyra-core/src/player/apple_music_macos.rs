//! macOS Music.app adapter (Apple Music streaming and local library files)
//! using Music's AppleScript dictionary.

use std::sync::{Arc, Mutex};

use crate::domain::{
    MediaKind, PlaybackCaps, PlaybackSnapshot, PlaybackState, PlayerApp, PositionQuality, TrackRef,
    Transport,
};
use crate::player::applescript::{
    automation_enabled, note_permission, parse_number, run_once, RunError, Script,
};
use crate::player::metadata::MetaRefresh;
use crate::player::{
    now_ms, sniff_image_mime, ArtworkBytes, ControlError, PlayerAdapter, PlayerCommand,
    SessionObservation,
};

const MUSIC_BUNDLE_ID: &str = "com.apple.Music";
const SESSION_ID: &str = "applescript:com.apple.Music";
const PLAYER_NAME: &str = "Apple Music";
/// ASCII unit separator: never appears in titles, unlike `|`.
const SEP: char = '\u{1f}';
/// Larger images are skipped rather than copied into the artwork store.
const MAX_ARTWORK_BYTES: usize = 10 * 1024 * 1024;

/// State, persistent ID and position. The running check is outside the
/// `tell` block so polling never launches Music.
static LITE: Script = Script::new(
    r#"
if application "Music" is not running then return "not_running"
tell application "Music"
    set ps to player state as string
    if ps is "stopped" then return "stopped"
    try
        set tid to persistent ID of current track
    on error
        return "no_track"
    end try
    set pos to ""
    try
        set pos to (player position as string)
    end try
    set sep to character id 31
    return ps & sep & tid & sep & pos
end tell
"#,
);

/// Full metadata for the current track; only run on track change. Each
/// field is read defensively because streams and radio leave some missing.
static META: Script = Script::new(
    r#"
if application "Music" is not running then return ""
tell application "Music"
    try
        set t to current track
        set tid to persistent ID of t
    on error
        return ""
    end try
    set tn to ""
    set ta to ""
    set tal to ""
    set tdur to ""
    set loc to ""
    try
        set tn to (name of t as string)
    end try
    try
        set ta to (artist of t as string)
    end try
    try
        set tal to (album of t as string)
    end try
    try
        set tdur to (duration of t as string)
    end try
    try
        if class of t is file track then set loc to POSIX path of (location of t)
    end try
    set sep to character id 31
    return tid & sep & tn & sep & ta & sep & tal & sep & tdur & sep & loc
end tell
"#,
);

static ARTWORK: Script = Script::new(
    r#"
if application "Music" is not running then return ""
tell application "Music"
    try
        return raw data of artwork 1 of current track
    on error
        return ""
    end try
end tell
"#,
);

/// Select the playing track in Music's window and bring Music forward.
static REVEAL: Script = Script::new(
    r#"
if application "Music" is not running then return "false"
tell application "Music"
    try
        reveal current track
    end try
    activate
end tell
return "true"
"#,
);

static PLAY_PAUSE: Script = Script::new(
    r#"
if application "Music" is not running then return "false"
tell application "Music" to playpause
return "true"
"#,
);

static NEXT_TRACK: Script = Script::new(
    r#"
if application "Music" is not running then return "false"
tell application "Music" to next track
return "true"
"#,
);

static PREVIOUS_TRACK: Script = Script::new(
    r#"
if application "Music" is not running then return "false"
tell application "Music" to previous track
return "true"
"#,
);

#[derive(Clone)]
struct CachedTrack {
    persistent_id: String,
    title: String,
    artist: String,
    album: Option<String>,
    duration_ms: u64,
    file_path: Option<String>,
    artwork: Option<Arc<[u8]>>,
    refresh: MetaRefresh,
}

impl CachedTrack {
    fn is_complete(&self) -> bool {
        self.duration_ms > 0 && self.artwork.is_some()
    }
}

pub struct AppleMusicMacOsAdapter {
    /// Returned again when an AppleScript call fails transiently.
    last: Mutex<Vec<SessionObservation>>,
    /// Metadata and artwork for the current track, read on change and again
    /// while incomplete or unsettled (streamed artwork can arrive late).
    cached: Mutex<Option<CachedTrack>>,
}

impl AppleMusicMacOsAdapter {
    pub fn new() -> Self {
        Self {
            last: Mutex::new(Vec::new()),
            cached: Mutex::new(None),
        }
    }

    fn track_for(&self, persistent_id: &str, now_ms: u64) -> Option<CachedTrack> {
        let mut cached = self.cached.lock().unwrap_or_else(|e| e.into_inner());
        let prev = cached
            .as_ref()
            .filter(|t| t.persistent_id == persistent_id)
            .cloned();
        if let Some(track) = prev.as_ref() {
            if !track.refresh.due(now_ms, track.is_complete()) {
                return Some(track.clone());
            }
        }
        let Some(fresh) = META
            .run()
            .as_deref()
            .and_then(|raw| parse_meta(raw, now_ms))
        else {
            // Keep the earlier read and wait a retry interval.
            let mut prev = prev?;
            prev.refresh.reread(now_ms);
            *cached = Some(prev.clone());
            return Some(prev);
        };
        let artwork = ARTWORK
            .run_data()
            .filter(|data| !data.is_empty() && data.len() <= MAX_ARTWORK_BYTES)
            .map(Arc::from);
        let mut track = CachedTrack { artwork, ..fresh };
        if let Some(prev) = prev.filter(|p| p.persistent_id == track.persistent_id) {
            // Never regress a field an earlier read already filled.
            track.refresh = prev.refresh;
            if track.duration_ms == 0 {
                track.duration_ms = prev.duration_ms;
            }
            if track.artwork.is_none() {
                track.artwork = prev.artwork;
            }
            track.refresh.reread(now_ms);
        }
        *cached = Some(track.clone());
        Some(track)
    }
}

impl Default for AppleMusicMacOsAdapter {
    fn default() -> Self {
        Self::new()
    }
}

enum Lite {
    Idle,
    Track {
        playing: bool,
        persistent_id: String,
        position_ms: Option<u64>,
    },
}

fn parse_lite(raw: &str) -> Option<Lite> {
    if matches!(raw, "not_running" | "stopped" | "no_track" | "") {
        return Some(Lite::Idle);
    }
    let mut parts = raw.splitn(3, SEP);
    let state = parts.next()?;
    let persistent_id = parts.next()?.to_string();
    let position_ms = parts
        .next()
        .and_then(parse_number)
        .map(|seconds| (seconds * 1000.0) as u64);
    Some(Lite::Track {
        // "fast forwarding" and "rewinding" move the position at a rate
        // Lyra cannot extrapolate; treat them as paused.
        playing: state == "playing",
        persistent_id,
        position_ms,
    })
}

fn parse_meta(raw: &str, now_ms: u64) -> Option<CachedTrack> {
    let fields: Vec<&str> = raw.splitn(6, SEP).collect();
    let [persistent_id, title, artist, album, duration, location] = fields.as_slice() else {
        return None;
    };
    let text = |s: &str| {
        let s = s.trim();
        (!s.is_empty() && s != "missing value").then(|| s.to_string())
    };
    Some(CachedTrack {
        persistent_id: persistent_id.to_string(),
        title: text(title)?,
        artist: text(artist).unwrap_or_default(),
        album: text(album),
        // Music reports duration in seconds.
        duration_ms: parse_number(duration).map_or(0, |s| (s * 1000.0) as u64),
        file_path: text(location),
        artwork: None,
        refresh: MetaRefresh::new(now_ms),
    })
}

fn seek_to_seconds(seconds: f64) -> bool {
    let source = format!(
        "if application \"Music\" is not running then return \"false\"\ntell application \"Music\" to set player position to {seconds}\nreturn \"true\""
    );
    run_once(&source).as_deref() == Some("true")
}

impl PlayerAdapter for AppleMusicMacOsAdapter {
    fn transport(&self) -> Transport {
        Transport::AppleScript
    }

    fn sessions(&self) -> Vec<SessionObservation> {
        let observed_at_ms = now_ms();
        if !automation_enabled() {
            return Vec::new();
        }
        let raw = match LITE.run_checked() {
            Ok(raw) => {
                note_permission(PLAYER_NAME, false);
                raw
            }
            Err(RunError::NotPermitted) => {
                note_permission(PLAYER_NAME, true);
                return Vec::new();
            }
            Err(RunError::Failed) => {
                return self.last.lock().map(|g| g.clone()).unwrap_or_default()
            }
        };
        let Some(lite) = parse_lite(&raw) else {
            return self.last.lock().map(|g| g.clone()).unwrap_or_default();
        };

        let sessions: Vec<SessionObservation> = match lite {
            Lite::Idle => {
                if let Ok(mut cached) = self.cached.lock() {
                    *cached = None;
                }
                Vec::new()
            }
            Lite::Track {
                playing,
                persistent_id,
                position_ms,
            } => self
                .track_for(&persistent_id, observed_at_ms)
                .map(|t| {
                    let uri = format!("applemusic:{}", t.persistent_id);
                    SessionObservation {
                        id: SESSION_ID.to_string(),
                        artwork: t.artwork.as_ref().map(|data| ArtworkBytes {
                            key: uri.clone(),
                            mime: sniff_image_mime(data),
                            data: Arc::clone(data),
                        }),
                        snapshot: PlaybackSnapshot {
                            track: Some(TrackRef {
                                player: PlayerApp {
                                    id: MUSIC_BUNDLE_ID.to_string(),
                                    name: "Apple Music".to_string(),
                                },
                                transport: Transport::AppleScript,
                                native_id: Some(uri.clone()),
                                uri,
                                file_path: t.file_path,
                                from_browser: false,
                                platform: None,
                                kind: MediaKind::Unsure,
                                page_url: None,
                                title: t.title,
                                artist: t.artist,
                                album: t.album,
                                duration_ms: t.duration_ms,
                                artwork_url: None,
                            }),
                            state: if playing {
                                PlaybackState::Playing
                            } else {
                                PlaybackState::Paused
                            },
                            position_ms,
                            observed_at_ms,
                            rate: 1.0,
                            ignored: None,
                            position_quality: if position_ms.is_some() {
                                PositionQuality::Exact
                            } else {
                                PositionQuality::Missing
                            },
                            caps: PlaybackCaps {
                                seek: position_ms.is_some(),
                                ..PlaybackCaps::ALL
                            },
                        },
                        os_current: false,
                    }
                })
                .into_iter()
                .collect(),
        };

        if let Ok(mut last) = self.last.lock() {
            *last = sessions.clone();
        }
        sessions
    }

    fn control(&self, session_id: &str, command: PlayerCommand) -> Result<(), ControlError> {
        if session_id != SESSION_ID {
            return Err(ControlError::NoSession);
        }
        let sent = match command {
            PlayerCommand::PlayPause => PLAY_PAUSE.run_command(),
            PlayerCommand::Next => NEXT_TRACK.run_command(),
            PlayerCommand::Previous => PREVIOUS_TRACK.run_command(),
            PlayerCommand::SeekMs(ms) => seek_to_seconds(ms as f64 / 1000.0),
            PlayerCommand::Raise => REVEAL.run_command(),
        };
        if sent {
            Ok(())
        } else {
            Err(ControlError::Failed)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lite_output_parses_state_and_locale_formatted_position() {
        let raw = format!("playing{SEP}ABC123{SEP}12,5");
        let Some(Lite::Track {
            playing,
            persistent_id,
            position_ms,
        }) = parse_lite(&raw)
        else {
            panic!("expected a track");
        };
        assert!(playing);
        assert_eq!(persistent_id, "ABC123");
        assert_eq!(position_ms, Some(12_500));
        assert!(matches!(parse_lite("not_running"), Some(Lite::Idle)));
        let raw = format!("paused{SEP}ABC123{SEP}");
        assert!(matches!(
            parse_lite(&raw),
            Some(Lite::Track {
                playing: false,
                position_ms: None,
                ..
            })
        ));
    }

    #[test]
    fn meta_output_keeps_local_file_path_and_skips_missing_values() {
        let raw = format!(
            "ABC123{SEP}Hello | World{SEP}Adele{SEP}missing value{SEP}295,5{SEP}/Users/me/Music/hello.m4a"
        );
        let track = parse_meta(&raw, 0).unwrap();
        assert_eq!(track.title, "Hello | World");
        assert_eq!(track.artist, "Adele");
        assert_eq!(track.album, None);
        assert_eq!(track.duration_ms, 295_500);
        assert_eq!(
            track.file_path.as_deref(),
            Some("/Users/me/Music/hello.m4a")
        );
        assert!(parse_meta(&format!("ABC{SEP}{SEP}a{SEP}b{SEP}1{SEP}"), 0).is_none());
    }
}
