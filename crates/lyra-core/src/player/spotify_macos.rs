use std::process::Command;
use std::sync::{mpsc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::domain::{PlaybackSnapshot, PlaybackState, PlayerSource, TrackRef};
use crate::events::PlayerEvent;
use crate::player::PlayerAdapter;

pub struct SpotifyMacOsAdapter {
    last: Mutex<Option<PlaybackSnapshot>>,
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

impl SpotifyMacOsAdapter {
    pub fn new() -> Self {
        Self {
            last: Mutex::new(None),
            cached_meta: Mutex::new(None),
        }
    }

    /// Lightweight poll: returns only the values that change between polls
    /// (player state, URI, current position). When the URI matches the
    /// cached one we skip the heavy metadata fetch.
    fn query_lite() -> Option<RawSpotifyLite> {
        let script = r#"
if application "Spotify" is not running then return "not_running"
tell application "Spotify"
    set ps to player state as string
    if ps is "stopped" then return "stopped"
    set tid to id of current track
    set pos to player position
    return ps & "|" & tid & "|" & (pos as string)
end tell
"#;
        let raw = run_osascript(script)?;
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
            position_ms: (parts[2].parse::<f64>().unwrap_or(0.0) * 1000.0) as u64,
        })
    }

    /// Full metadata fetch — only invoked on track change.
    fn query_meta() -> Option<CachedMeta> {
        let script = r#"
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
"#;
        let raw = run_osascript(script)?;
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
            duration_ms: parts[4].parse::<f64>().unwrap_or(0.0) as u64,
            artwork_url,
        })
    }
}

fn run_osascript(script: &'static str) -> Option<String> {
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let out = Command::new("osascript").arg("-e").arg(script).output();
        let _ = tx.send(out);
    });
    let out = match rx.recv_timeout(Duration::from_secs(3)) {
        Ok(Ok(o)) => o,
        _ => return None,
    };
    Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

enum RawSpotifyLite {
    Stopped,
    Track {
        state: String,
        uri: String,
        position_ms: u64,
    },
}

impl Default for SpotifyMacOsAdapter {
    fn default() -> Self {
        Self::new()
    }
}

fn run_spotify_command(command: &str) -> bool {
    let script = format!(
        "if application \"Spotify\" is not running then return\ntell application \"Spotify\" to {}",
        command
    );
    Command::new("osascript")
        .arg("-e")
        .arg(&script)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

pub fn play_pause() -> bool {
    run_spotify_command("playpause")
}

pub fn next_track() -> bool {
    run_spotify_command("next track")
}

pub fn previous_track() -> bool {
    run_spotify_command("previous track")
}

/// Seek to a position in seconds (Spotify's `player position` is seconds, double).
pub fn seek_to_seconds(seconds: f64) -> bool {
    run_spotify_command(&format!("set player position to {}", seconds))
}

impl PlayerAdapter for SpotifyMacOsAdapter {
    fn name(&self) -> &str {
        "spotify-macos-applescript"
    }

    fn source(&self) -> PlayerSource {
        PlayerSource::SpotifyMacOs
    }

    fn snapshot(&self) -> Option<PlaybackSnapshot> {
        self.last.lock().ok()?.clone()
    }

    fn poll(&self) -> Option<PlayerEvent> {
        let observed_at_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);

        let lite = Self::query_lite()?;

        let new_snapshot = match lite {
            RawSpotifyLite::Stopped => {
                // Drop cached metadata: a future track change shouldn't be
                // satisfied from a stale URI match.
                if let Ok(mut c) = self.cached_meta.lock() {
                    *c = None;
                }
                PlaybackSnapshot {
                    track: None,
                    state: PlaybackState::Stopped,
                    position_ms: None,
                    observed_at_ms,
                }
            }
            RawSpotifyLite::Track { state, uri, position_ms } => {
                let pb_state = if state == "playing" {
                    PlaybackState::Playing
                } else {
                    PlaybackState::Paused
                };

                // Reuse cached metadata when URI matches — saves five Apple
                // Event roundtrips to Spotify on every same-track poll.
                let meta = {
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
                };

                let track = meta.map(|m| TrackRef {
                    source: PlayerSource::SpotifyMacOs,
                    uri: uri.clone(),
                    title: m.title,
                    artist: m.artist,
                    album: if m.album.is_empty() { None } else { Some(m.album) },
                    duration_ms: m.duration_ms,
                    artwork_url: m.artwork_url,
                });

                PlaybackSnapshot {
                    track,
                    state: pb_state,
                    position_ms: Some(position_ms),
                    observed_at_ms,
                }
            }
        };

        let mut last_guard = self.last.lock().ok()?;

        let event = derive_event(&last_guard, &new_snapshot);
        *last_guard = Some(new_snapshot);
        event
    }
}

fn derive_event(prev: &Option<PlaybackSnapshot>, next: &PlaybackSnapshot) -> Option<PlayerEvent> {
    let Some(prev) = prev else {
        return next.track.as_ref().map(|t| PlayerEvent::TrackChanged(t.clone()));
    };

    let prev_uri = prev.track.as_ref().map(|t| &t.uri);
    let next_uri = next.track.as_ref().map(|t| &t.uri);

    if prev_uri != next_uri {
        return match &next.track {
            Some(t) => Some(PlayerEvent::TrackChanged(t.clone())),
            None => Some(PlayerEvent::PlayerStopped),
        };
    }

    if prev.state != next.state {
        return Some(PlayerEvent::StateChanged(next.state.clone()));
    }

    // Detect seeks: position delta differs materially from elapsed wall-clock time.
    if let (Some(prev_pos), Some(next_pos)) = (prev.position_ms, next.position_ms) {
        let wall_delta = next.observed_at_ms.saturating_sub(prev.observed_at_ms);
        let pos_delta = next_pos as i64 - prev_pos as i64;
        let drift = (pos_delta - wall_delta as i64).unsigned_abs();
        if drift > 800 {
            return Some(PlayerEvent::PositionJumped(next_pos));
        }
    }

    None
}
