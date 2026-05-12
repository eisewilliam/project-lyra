//! Windows Spotify adapter using System Media Transport Controls (SMTC).
//!
//! Spotify registers itself with SMTC when playing, exposing track metadata
//! and playback state through the standard Windows media session API.
//! This module is only compiled on Windows (`cfg(target_os = "windows")`).

use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use windows::{
    Media::Control::{
        GlobalSystemMediaTransportControlsSession,
        GlobalSystemMediaTransportControlsSessionManager,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus,
    },
    Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED},
};

use crate::domain::{PlaybackSnapshot, PlaybackState, PlayerSource, TrackRef};
use crate::events::PlayerEvent;
use crate::player::PlayerAdapter;

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Find the Spotify SMTC session by scanning all registered media sessions.
/// Returns the first session whose SourceAppUserModelId contains "spotify".
fn find_spotify_session() -> Option<GlobalSystemMediaTransportControlsSession> {
    let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
        .ok()?
        .get()
        .ok()?;

    let sessions = manager.GetSessions().ok()?;
    let count = sessions.Size().ok()?;

    for i in 0..count {
        if let Ok(session) = sessions.GetAt(i) {
            if let Ok(id) = session.SourceAppUserModelId() {
                if id.to_string().to_lowercase().contains("spotify") {
                    return Some(session);
                }
            }
        }
    }

    None
}

pub struct SpotifyWindowsAdapter {
    last: Mutex<Option<PlaybackSnapshot>>,
}

impl SpotifyWindowsAdapter {
    pub fn new() -> Self {
        // Initialize COM multi-threaded apartment for this thread so WinRT
        // async operations can complete. S_FALSE means already initialized —
        // both outcomes are fine.
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        }
        Self { last: Mutex::new(None) }
    }
}

impl Default for SpotifyWindowsAdapter {
    fn default() -> Self {
        Self::new()
    }
}

impl PlayerAdapter for SpotifyWindowsAdapter {
    fn name(&self) -> &str {
        "SpotifyWindows"
    }

    fn source(&self) -> PlayerSource {
        PlayerSource::WindowsSmtc
    }

    fn snapshot(&self) -> Option<PlaybackSnapshot> {
        self.last.lock().ok()?.clone()
    }

    fn poll(&self) -> Option<PlayerEvent> {
        let mut last_guard = self.last.lock().ok()?;

        let new_snapshot = match find_spotify_session() {
            // Spotify not registered with SMTC → treat as stopped.
            None => PlaybackSnapshot {
                track: None,
                state: PlaybackState::Stopped,
                position_ms: None,
                observed_at_ms: now_ms(),
            },

            Some(session) => {
                // Media properties fetch is async; block on it.
                let props = match session
                    .TryGetMediaPropertiesAsync()
                    .and_then(|op| op.get())
                {
                    Ok(p) => p,
                    Err(_) => return None, // transient WinRT error — keep last snapshot
                };

                let title = match props.Title() {
                    Ok(t) => t.to_string(),
                    Err(_) => return None,
                };
                let artist = match props.Artist() {
                    Ok(a) => a.to_string(),
                    Err(_) => return None,
                };
                let album = props
                    .AlbumTitle()
                    .ok()
                    .map(|s| s.to_string())
                    .filter(|s| !s.is_empty());

                // Get playback state.
                let pb_status = session
                    .GetPlaybackInfo()
                    .and_then(|info| info.PlaybackStatus())
                    .ok();

                let state = match pb_status {
                    Some(s)
                        if s == GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing =>
                    {
                        PlaybackState::Playing
                    }
                    Some(s)
                        if s == GlobalSystemMediaTransportControlsSessionPlaybackStatus::Paused =>
                    {
                        PlaybackState::Paused
                    }
                    _ => PlaybackState::Stopped,
                };

                // Spotify shows empty title on ads / loading gaps — treat as stopped.
                if title.is_empty() || state == PlaybackState::Stopped {
                    PlaybackSnapshot {
                        track: None,
                        state: PlaybackState::Stopped,
                        position_ms: None,
                        observed_at_ms: now_ms(),
                    }
                } else {
                    let timeline = session.GetTimelineProperties().ok();
                    let duration_ms = timeline
                        .as_ref()
                        .and_then(|t| t.EndTime().ok())
                        .map(|ts| (ts.Duration.max(0) / 10_000) as u64)
                        .unwrap_or(0);
                    let position_ms = timeline
                        .as_ref()
                        .and_then(|t| t.Position().ok())
                        .map(|ts| (ts.Duration.max(0) / 10_000) as u64);

                    // Build a synthetic URI from artist + title for cache keying.
                    // SMTC doesn't expose the Spotify URI; lrclib fetches by
                    // title/artist anyway. This key is stable across restarts.
                    let uri = format!(
                        "smtc::{}::{}",
                        urlencoding::encode(&artist.to_lowercase()),
                        urlencoding::encode(&title.to_lowercase()),
                    );

                    PlaybackSnapshot {
                        track: Some(TrackRef {
                            source: PlayerSource::WindowsSmtc,
                            uri,
                            title,
                            artist,
                            album,
                            duration_ms,
                            artwork_url: None, // SMTC artwork is a stream ref, not a URL
                        }),
                        state,
                        position_ms,
                        observed_at_ms: now_ms(),
                    }
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

    // Detect seeks: if the observed position differs materially from what
    // would be expected based on elapsed wall-clock time.
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

// ── Playback control free functions ──────────────────────────────────────────

pub fn play_pause() -> bool {
    let Some(session) = find_spotify_session() else { return false };
    let is_playing = session
        .GetPlaybackInfo()
        .and_then(|info| info.PlaybackStatus())
        .map(|s| s == GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing)
        .unwrap_or(false);

    if is_playing {
        session.TryPauseAsync().and_then(|op| op.get()).is_ok()
    } else {
        session.TryPlayAsync().and_then(|op| op.get()).is_ok()
    }
}

pub fn next_track() -> bool {
    find_spotify_session()
        .and_then(|s| s.TrySkipNextAsync().ok())
        .and_then(|op| op.get().ok())
        .unwrap_or(false)
}

pub fn previous_track() -> bool {
    find_spotify_session()
        .and_then(|s| s.TrySkipPreviousAsync().ok())
        .and_then(|op| op.get().ok())
        .unwrap_or(false)
}

/// Seek to `seconds` from the track start.
/// SMTC takes position in 100-nanosecond ticks.
pub fn seek_to_seconds(seconds: f64) -> bool {
    let ticks = (seconds * 10_000_000.0) as i64;
    find_spotify_session()
        .and_then(|s| s.TryChangePlaybackPositionAsync(ticks).ok())
        .and_then(|op| op.get().ok())
        .unwrap_or(false)
}
