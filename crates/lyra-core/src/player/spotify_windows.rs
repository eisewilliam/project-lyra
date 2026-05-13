//! Windows Spotify adapter using System Media Transport Controls (SMTC).
//!
//! Spotify registers itself with SMTC when playing, exposing track metadata
//! and playback state through the standard Windows media session API.
//! This module is only compiled on Windows (`cfg(target_os = "windows")`).

use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use base64::{engine::general_purpose::STANDARD, Engine};
use windows::{
    Media::Control::{
        GlobalSystemMediaTransportControlsSession,
        GlobalSystemMediaTransportControlsSessionManager,
        GlobalSystemMediaTransportControlsSessionMediaProperties,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus,
        GlobalSystemMediaTransportControlsSessionTimelineProperties,
    },
    Storage::Streams::{DataReader, IInputStream},
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

/// Read the SMTC thumbnail stream and return a `data:` URL, or `None` if unavailable.
fn fetch_thumbnail_data_url(
    props: &GlobalSystemMediaTransportControlsSessionMediaProperties,
) -> Option<String> {
    use windows::core::Interface;
    let stream_ref = props.Thumbnail().ok()?;
    let stream = stream_ref.OpenReadAsync().ok()?.get().ok()?;
    let size = stream.Size().ok()? as u32;
    if size == 0 || size > 10 * 1024 * 1024 {
        return None;
    }
    let input: IInputStream = stream.cast().ok()?;
    let reader = DataReader::CreateDataReader(&input).ok()?;
    reader.LoadAsync(size).ok()?.get().ok()?;
    let mut buf = vec![0u8; size as usize];
    reader.ReadBytes(&mut buf).ok()?;

    let mime = if buf.starts_with(&[0xFF, 0xD8]) {
        "image/jpeg"
    } else if buf.starts_with(&[0x89, 0x50, 0x4E, 0x47]) {
        "image/png"
    } else {
        "image/jpeg"
    };

    Some(format!("data:{};base64,{}", mime, STANDARD.encode(&buf)))
}

/// Extrapolate SMTC playback position to wall-clock "now".
///
/// SMTC's `Position` is the position at `LastUpdatedTime` — Spotify only pushes
/// updates periodically, so the raw value can be several seconds stale. Adding
/// `(now − LastUpdatedTime)` gives an accurate current position and avoids the
/// large discrete jumps the polling loop would otherwise see.
///
/// When paused, the raw position is returned unchanged.
fn extrapolate_position(
    timeline: &Option<GlobalSystemMediaTransportControlsSessionTimelineProperties>,
    duration_ms: u64,
    state: &PlaybackState,
) -> (Option<u64>, u64) {
    let raw_pos_ms = timeline
        .as_ref()
        .and_then(|t| t.Position().ok())
        .map(|ts| (ts.Duration.max(0) / 10_000) as u64);

    let now = now_ms();

    if *state != PlaybackState::Playing {
        return (raw_pos_ms, now);
    }

    let last_updated_unix_ms = timeline
        .as_ref()
        .and_then(|t| t.LastUpdatedTime().ok())
        .and_then(|dt| {
            // DateTime.UniversalTime = 100ns ticks since 1601-01-01.
            // Subtract Windows→Unix epoch offset (116,444,736,000,000,000 ticks).
            const EPOCH_OFFSET: i64 = 116_444_736_000_000_000;
            if dt.UniversalTime > EPOCH_OFFSET {
                Some(((dt.UniversalTime - EPOCH_OFFSET) / 10_000) as u64)
            } else {
                None
            }
        });

    match (raw_pos_ms, last_updated_unix_ms) {
        (Some(pos), Some(last_upd)) => {
            let elapsed = now.saturating_sub(last_upd);
            let extrapolated = pos + elapsed;
            let capped = if duration_ms > 0 {
                extrapolated.min(duration_ms)
            } else {
                extrapolated
            };
            (Some(capped), now)
        }
        _ => (raw_pos_ms, now),
    }
}

struct ArtworkCache {
    key: String,
    data_url: String,
}

pub struct SpotifyWindowsAdapter {
    last: Mutex<Option<PlaybackSnapshot>>,
    artwork: Mutex<Option<ArtworkCache>>,
}

impl SpotifyWindowsAdapter {
    pub fn new() -> Self {
        // Initialize COM multi-threaded apartment for this thread so WinRT
        // async operations can complete. S_FALSE means already initialized —
        // both outcomes are fine.
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        }
        Self {
            last: Mutex::new(None),
            artwork: Mutex::new(None),
        }
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
                let props = match session.TryGetMediaPropertiesAsync().and_then(|op| op.get()) {
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
                        if s
                            == GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing =>
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

                    let (position_ms, observed_at_ms) =
                        extrapolate_position(&timeline, duration_ms, &state);

                    // Build a synthetic URI from artist + title for cache keying.
                    // SMTC doesn't expose the Spotify URI; lrclib fetches by
                    // title/artist anyway. This key is stable across restarts.
                    let uri = format!(
                        "smtc::{}::{}",
                        urlencoding::encode(&artist.to_lowercase()),
                        urlencoding::encode(&title.to_lowercase()),
                    );

                    // Fetch thumbnail only when the track changes (cache by URI).
                    let artwork_url = {
                        let mut cache = self.artwork.lock().unwrap_or_else(|e| e.into_inner());
                        if cache.as_ref().map(|c| c.key.as_str()) == Some(uri.as_str()) {
                            cache.as_ref().map(|c| c.data_url.clone())
                        } else {
                            let url = fetch_thumbnail_data_url(&props);
                            *cache = url.as_ref().map(|u| ArtworkCache {
                                key: uri.clone(),
                                data_url: u.clone(),
                            });
                            url
                        }
                    };

                    PlaybackSnapshot {
                        track: Some(TrackRef {
                            source: PlayerSource::WindowsSmtc,
                            uri,
                            title,
                            artist,
                            album,
                            duration_ms,
                            artwork_url,
                        }),
                        state,
                        position_ms,
                        observed_at_ms,
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
        return next
            .track
            .as_ref()
            .map(|t| PlayerEvent::TrackChanged(t.clone()));
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
    let Some(session) = find_spotify_session() else {
        return false;
    };
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
