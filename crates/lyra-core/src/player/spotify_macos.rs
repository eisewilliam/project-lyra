use std::process::Command;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::domain::{PlaybackSnapshot, PlaybackState, PlayerSource, TrackRef};
use crate::events::PlayerEvent;
use crate::player::PlayerAdapter;

pub struct SpotifyMacOsAdapter {
    last: Mutex<Option<PlaybackSnapshot>>,
}

impl SpotifyMacOsAdapter {
    pub fn new() -> Self {
        Self { last: Mutex::new(None) }
    }

    fn query() -> Option<RawSpotifyState> {
        let script = r#"
tell application "Spotify"
    if it is not running then return "not_running"
    set ps to player state as string
    if ps is "stopped" then return "stopped"
    set tid to id of current track
    set tn to name of current track
    set ta to artist of current track
    set tal to album of current track
    set tdur to duration of current track
    set pos to player position
    return ps & "|" & tid & "|" & tn & "|" & ta & "|" & tal & "|" & (tdur as string) & "|" & (pos as string)
end tell
"#;

        let out = Command::new("osascript").arg("-e").arg(script).output().ok()?;
        let raw = String::from_utf8_lossy(&out.stdout).trim().to_string();

        if raw == "not_running" || raw == "stopped" || raw.is_empty() {
            return Some(RawSpotifyState::Stopped);
        }

        let parts: Vec<&str> = raw.splitn(7, '|').collect();
        if parts.len() != 7 {
            return None;
        }

        Some(RawSpotifyState::Track {
            state: parts[0].to_string(),
            uri: parts[1].to_string(),
            title: parts[2].to_string(),
            artist: parts[3].to_string(),
            album: parts[4].to_string(),
            duration_ms: (parts[5].parse::<f64>().unwrap_or(0.0) * 1000.0) as u64,
            position_ms: (parts[6].parse::<f64>().unwrap_or(0.0) * 1000.0) as u64,
        })
    }
}

enum RawSpotifyState {
    Stopped,
    Track {
        state: String,
        uri: String,
        title: String,
        artist: String,
        album: String,
        duration_ms: u64,
        position_ms: u64,
    },
}

impl Default for SpotifyMacOsAdapter {
    fn default() -> Self {
        Self::new()
    }
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

        let raw = Self::query()?;
        let mut last_guard = self.last.lock().ok()?;

        let new_snapshot = match raw {
            RawSpotifyState::Stopped => PlaybackSnapshot {
                track: None,
                state: PlaybackState::Stopped,
                position_ms: None,
                observed_at_ms,
            },
            RawSpotifyState::Track { state, uri, title, artist, album, duration_ms, position_ms } => {
                let pb_state = if state == "playing" {
                    PlaybackState::Playing
                } else {
                    PlaybackState::Paused
                };
                PlaybackSnapshot {
                    track: Some(TrackRef {
                        source: PlayerSource::SpotifyMacOs,
                        uri,
                        title,
                        artist,
                        album: if album.is_empty() { None } else { Some(album) },
                        duration_ms,
                    }),
                    state: pb_state,
                    position_ms: Some(position_ms),
                    observed_at_ms,
                }
            }
        };

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
