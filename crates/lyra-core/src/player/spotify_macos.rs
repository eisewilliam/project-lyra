//! macOS Spotify adapter using Spotify's AppleScript dictionary.

use std::sync::Mutex;

use crate::domain::{
    MediaKind, PlaybackCaps, PlaybackSnapshot, PlaybackState, PlayerApp, PositionQuality, TrackRef,
    Transport,
};
use crate::player::applescript::{parse_number, run_once, Script};
use crate::player::{
    macos_open, now_ms, ControlError, PlayerAdapter, PlayerCommand, SessionObservation,
};

const SPOTIFY_BUNDLE_ID: &str = "com.spotify.client";
const SESSION_ID: &str = "applescript:com.spotify.client";

/// Lightweight poll: only the values that change between polls. The running
/// check is outside the `tell` block so polling never launches Spotify.
static LITE: Script = Script::new(
    r#"
if application "Spotify" is not running then return "not_running"
tell application "Spotify"
    set ps to player state as string
    if ps is "stopped" then return "stopped"
    set tid to id of current track
    set pos to player position
    return ps & "|" & tid & "|" & (pos as string)
end tell
"#,
);

/// Full metadata fetch — only invoked on track change.
static META: Script = Script::new(
    r#"
if application "Spotify" is not running then return "not_running"
tell application "Spotify"
    set ps to player state as string
    if ps is "stopped" then return "stopped"
    set tid to id of current track
    set tn to name of current track
    set ta to artist of current track
    set tal to album of current track
    set tdur to duration of current track
    set tart to ""
    try
        set tart to artwork url of current track
    end try
    return tid & "|" & tn & "|" & ta & "|" & tal & "|" & (tdur as string) & "|" & tart
end tell
"#,
);

static PLAY_PAUSE: Script = Script::new(
    r#"
if application "Spotify" is not running then return "false"
tell application "Spotify" to playpause
return "true"
"#,
);

static NEXT_TRACK: Script = Script::new(
    r#"
if application "Spotify" is not running then return "false"
tell application "Spotify" to next track
return "true"
"#,
);

static PREVIOUS_TRACK: Script = Script::new(
    r#"
if application "Spotify" is not running then return "false"
tell application "Spotify" to previous track
return "true"
"#,
);

pub struct SpotifyMacOsAdapter {
    /// Returned again when an AppleScript call fails transiently.
    last: Mutex<Vec<SessionObservation>>,
    /// Cached heavy metadata keyed by Spotify track URI. The hot polling
    /// path only fetches state + URI + position via AppleScript; the
    /// title/artist/album/duration/artwork accessors involve extra Apple
    /// Events to Spotify and only need to run on track change.
    cached_meta: Mutex<Option<CachedMeta>>,
}

#[derive(Clone)]
struct CachedMeta {
    uri: String,
    title: String,
    artist: String,
    album: String,
    duration_ms: u64,
    artwork_url: Option<String>,
}

enum RawSpotifyLite {
    Stopped,
    Track {
        state: String,
        uri: String,
        position_ms: u64,
    },
}

impl SpotifyMacOsAdapter {
    pub fn new() -> Self {
        Self {
            last: Mutex::new(Vec::new()),
            cached_meta: Mutex::new(None),
        }
    }

    fn query_lite() -> Option<RawSpotifyLite> {
        let raw = LITE.run()?;
        if raw == "not_running" || raw == "stopped" || raw.is_empty() {
            return Some(RawSpotifyLite::Stopped);
        }
        let parts: Vec<&str> = raw.splitn(3, '|').collect();
        if parts.len() < 3 {
            return None;
        }
        Some(RawSpotifyLite::Track {
            state: parts[0].to_string(),
            uri: parts[1].to_string(),
            position_ms: (parse_number(parts[2]).unwrap_or(0.0) * 1000.0) as u64,
        })
    }

    fn query_meta() -> Option<CachedMeta> {
        let raw = META.run()?;
        if raw == "not_running" || raw == "stopped" || raw.is_empty() {
            return None;
        }
        let parts: Vec<&str> = raw.splitn(6, '|').collect();
        if parts.len() < 5 {
            return None;
        }
        let artwork_url = parts
            .get(5)
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        Some(CachedMeta {
            uri: parts[0].to_string(),
            title: parts[1].to_string(),
            artist: parts[2].to_string(),
            album: parts[3].to_string(),
            // Spotify reports duration in milliseconds.
            duration_ms: parse_number(parts[4]).unwrap_or(0.0) as u64,
            artwork_url,
        })
    }

    /// Reuse cached metadata when the URI matches — saves five Apple Event
    /// roundtrips to Spotify on every same-track poll.
    fn meta_for(&self, uri: &str) -> Option<CachedMeta> {
        let cached = self.cached_meta.lock().ok().and_then(|g| g.clone());
        match cached {
            Some(m) if m.uri == uri => Some(m),
            _ => {
                let fresh = Self::query_meta();
                if let (Some(ref m), Ok(mut slot)) = (&fresh, self.cached_meta.lock()) {
                    *slot = Some(m.clone());
                }
                fresh
            }
        }
    }
}

impl SpotifyMacOsAdapter {
    /// Open the current track's `spotify:` URI, which brings Spotify forward
    /// on that track; fall back to activating the app.
    fn raise(&self) -> bool {
        let uri = self.last.lock().ok().and_then(|sessions| {
            sessions
                .first()
                .and_then(|s| s.snapshot.track.as_ref())
                .and_then(|t| t.native_id.clone())
        });
        match uri {
            Some(uri) if uri.starts_with("spotify:") => macos_open(&[&uri]),
            _ => macos_open(&["-b", SPOTIFY_BUNDLE_ID]),
        }
    }
}

impl Default for SpotifyMacOsAdapter {
    fn default() -> Self {
        Self::new()
    }
}

/// Seek to a position in seconds (Spotify's `player position` is seconds, double).
fn seek_to_seconds(seconds: f64) -> bool {
    let source = format!(
        "if application \"Spotify\" is not running then return \"false\"\ntell application \"Spotify\" to set player position to {seconds}\nreturn \"true\""
    );
    run_once(&source).as_deref() == Some("true")
}

impl PlayerAdapter for SpotifyMacOsAdapter {
    fn transport(&self) -> Transport {
        Transport::AppleScript
    }

    fn sessions(&self) -> Vec<SessionObservation> {
        let observed_at_ms = now_ms();

        let Some(lite) = Self::query_lite() else {
            return self.last.lock().map(|g| g.clone()).unwrap_or_default();
        };

        let sessions: Vec<SessionObservation> = match lite {
            RawSpotifyLite::Stopped => {
                // Drop cached metadata: a future track change shouldn't be
                // satisfied from a stale URI match.
                if let Ok(mut c) = self.cached_meta.lock() {
                    *c = None;
                }
                Vec::new()
            }
            RawSpotifyLite::Track {
                state,
                uri,
                position_ms,
            } => {
                let pb_state = if state == "playing" {
                    PlaybackState::Playing
                } else {
                    PlaybackState::Paused
                };
                self.meta_for(&uri)
                    .map(|m| SessionObservation {
                        id: SESSION_ID.to_string(),
                        snapshot: PlaybackSnapshot {
                            track: Some(TrackRef {
                                player: PlayerApp {
                                    id: SPOTIFY_BUNDLE_ID.to_string(),
                                    name: "Spotify".to_string(),
                                },
                                transport: Transport::AppleScript,
                                native_id: Some(uri.clone()),
                                uri,
                                file_path: None,
                                from_browser: false,
                                platform: None,
                                kind: MediaKind::Unsure,
                                page_url: None,
                                title: m.title,
                                artist: m.artist,
                                album: (!m.album.is_empty()).then_some(m.album),
                                duration_ms: m.duration_ms,
                                artwork_url: m.artwork_url,
                            }),
                            state: pb_state,
                            position_ms: Some(position_ms),
                            observed_at_ms,
                            rate: 1.0,
                            ignored: None,
                            position_quality: PositionQuality::Exact,
                            caps: PlaybackCaps::ALL,
                        },
                        artwork: None,
                        os_current: false,
                    })
                    .into_iter()
                    .collect()
            }
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
            PlayerCommand::Raise => self.raise(),
        };
        if sent {
            Ok(())
        } else {
            Err(ControlError::Failed)
        }
    }
}
