//! Windows adapter for System Media Transport Controls (SMTC).
//!
//! Every app that publishes a media session — Spotify, Apple Music for
//! Windows, browsers playing YouTube Music, local players — appears in the
//! global session manager. This module is only compiled on Windows.

use std::cell::Cell;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use windows::{
    Media::Control::{
        GlobalSystemMediaTransportControlsSession,
        GlobalSystemMediaTransportControlsSessionManager,
        GlobalSystemMediaTransportControlsSessionMediaProperties,
        GlobalSystemMediaTransportControlsSessionPlaybackInfo,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus,
        GlobalSystemMediaTransportControlsSessionTimelineProperties,
    },
    Storage::Streams::{DataReader, IInputStream},
    Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED},
};

use crate::domain::{
    MediaKind, PlaybackCaps, PlaybackSnapshot, PlaybackState, PlayerApp, PositionQuality, TrackRef,
    Transport,
};
use crate::player::metadata::{display_name, metadata_key};
use crate::player::{
    now_ms, sniff_image_mime, ArtworkBytes, ControlError, PlayerAdapter, PlayerCommand,
    SessionObservation,
};

const SESSION_PREFIX: &str = "smtc:";
const MAX_THUMBNAIL_BYTES: u32 = 10 * 1024 * 1024;

thread_local! {
    static COM_READY: Cell<bool> = const { Cell::new(false) };
}

/// Join the multi-threaded COM apartment once per calling thread. Polls and
/// commands run on different threads, and WinRT async calls need COM.
fn ensure_com() {
    COM_READY.with(|ready| {
        if !ready.get() {
            // S_FALSE (already initialized) and RPC_E_CHANGED_MODE (thread is
            // STA) both leave WinRT usable; only remember that we tried.
            unsafe {
                let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
            }
            ready.set(true);
        }
    });
}

fn session_manager() -> Option<GlobalSystemMediaTransportControlsSessionManager> {
    GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
        .ok()?
        .get()
        .ok()
}

/// Session IDs are `smtc:<AUMID>`, with `#n` appended when one app has
/// several sessions (e.g. two browser windows).
fn session_id(aumid: &str, ordinal: usize) -> String {
    if ordinal == 0 {
        format!("{SESSION_PREFIX}{aumid}")
    } else {
        format!("{SESSION_PREFIX}{aumid}#{ordinal}")
    }
}

fn parse_session_id(id: &str) -> Option<(&str, usize)> {
    let rest = id.strip_prefix(SESSION_PREFIX)?;
    match rest.rsplit_once('#') {
        Some((aumid, n)) => Some((aumid, n.parse().ok()?)),
        None => Some((rest, 0)),
    }
}

/// Every session with its AUMID and per-app ordinal, in manager order.
fn all_sessions(
    manager: &GlobalSystemMediaTransportControlsSessionManager,
) -> Option<Vec<(GlobalSystemMediaTransportControlsSession, String, usize)>> {
    let sessions = manager.GetSessions().ok()?;
    let count = sessions.Size().ok()?;
    let mut ordinals: HashMap<String, usize> = HashMap::new();
    let mut out = Vec::new();
    for i in 0..count {
        let Ok(session) = sessions.GetAt(i) else {
            continue;
        };
        let Ok(aumid) = session.SourceAppUserModelId() else {
            continue;
        };
        let aumid = aumid.to_string();
        let ordinal = ordinals.entry(aumid.clone()).or_default();
        out.push((session, aumid, *ordinal));
        *ordinal += 1;
    }
    Some(out)
}

/// Read the SMTC thumbnail stream, capped at 10 MiB.
fn fetch_thumbnail(
    props: &GlobalSystemMediaTransportControlsSessionMediaProperties,
) -> Option<Arc<[u8]>> {
    use windows::core::Interface;
    let stream_ref = props.Thumbnail().ok()?;
    let stream = stream_ref.OpenReadAsync().ok()?.get().ok()?;
    let size = stream.Size().ok()? as u32;
    if size == 0 || size > MAX_THUMBNAIL_BYTES {
        return None;
    }
    let input: IInputStream = stream.cast().ok()?;
    let reader = DataReader::CreateDataReader(&input).ok()?;
    reader.LoadAsync(size).ok()?.get().ok()?;
    let mut buf = vec![0u8; size as usize];
    reader.ReadBytes(&mut buf).ok()?;
    Some(Arc::from(buf))
}

fn playback_caps(info: &GlobalSystemMediaTransportControlsSessionPlaybackInfo) -> PlaybackCaps {
    let Ok(controls) = info.Controls() else {
        return PlaybackCaps::NONE;
    };
    let enabled = |flag: windows::core::Result<bool>| flag.unwrap_or(false);
    PlaybackCaps {
        play_pause: enabled(controls.IsPlayPauseToggleEnabled())
            || enabled(controls.IsPlayEnabled())
            || enabled(controls.IsPauseEnabled()),
        next: enabled(controls.IsNextEnabled()),
        previous: enabled(controls.IsPreviousEnabled()),
        seek: enabled(controls.IsPlaybackPositionEnabled()),
        // Set per app by `can_raise`.
        raise: false,
    }
}

/// Packaged apps (AUMID `Package!App`, e.g. Apple Music) activate through
/// the shell's AppsFolder; Spotify through its URI scheme. Other desktop apps
/// and browsers cannot be brought forward from an AUMID alone.
fn can_raise(aumid: &str) -> bool {
    aumid.contains('!') || aumid.to_lowercase().contains("spotify")
}

fn raise(aumid: &str) -> Result<(), ControlError> {
    let target = if aumid.to_lowercase().contains("spotify") {
        "spotify:".to_string()
    } else {
        format!("shell:AppsFolder\\{aumid}")
    };
    // explorer.exe reports a non-zero exit code even on success.
    std::process::Command::new("explorer.exe")
        .arg(target)
        .spawn()
        .map(|_| ())
        .map_err(|_| ControlError::Failed)
}

fn playback_rate(info: &GlobalSystemMediaTransportControlsSessionPlaybackInfo) -> f64 {
    info.PlaybackRate()
        .and_then(|rate| rate.Value())
        .ok()
        .filter(|rate| rate.is_finite() && *rate > 0.0)
        .unwrap_or(1.0)
}

fn ticks_to_ms(ticks: i64) -> u64 {
    (ticks.max(0) / 10_000) as u64
}

/// Extrapolate SMTC playback position to wall-clock "now".
///
/// SMTC's `Position` is the position at `LastUpdatedTime` — players only push
/// updates periodically, so the raw value can be several seconds stale. Adding
/// `(now − LastUpdatedTime) × rate` gives an accurate current position and
/// avoids the large discrete jumps the polling loop would otherwise see.
///
/// When paused, the raw position is returned unchanged.
fn extrapolate_position(
    timeline: &GlobalSystemMediaTransportControlsSessionTimelineProperties,
    duration_ms: u64,
    state: &PlaybackState,
    rate: f64,
) -> Option<u64> {
    let raw_pos_ms = timeline
        .Position()
        .ok()
        .map(|ts| ticks_to_ms(ts.Duration))?;
    if *state != PlaybackState::Playing {
        return Some(raw_pos_ms);
    }

    // DateTime.UniversalTime = 100ns ticks since 1601-01-01.
    // Subtract Windows→Unix epoch offset (116,444,736,000,000,000 ticks).
    const EPOCH_OFFSET: i64 = 116_444_736_000_000_000;
    let last_updated_unix_ms = timeline
        .LastUpdatedTime()
        .ok()
        .filter(|dt| dt.UniversalTime > EPOCH_OFFSET)
        .map(|dt| ((dt.UniversalTime - EPOCH_OFFSET) / 10_000) as u64);

    let Some(last_updated) = last_updated_unix_ms else {
        return Some(raw_pos_ms);
    };
    let elapsed = (now_ms().saturating_sub(last_updated) as f64 * rate) as u64;
    let extrapolated = raw_pos_ms + elapsed;
    Some(if duration_ms > 0 {
        extrapolated.min(duration_ms)
    } else {
        extrapolated
    })
}

/// Cache key for a track. Spotify keeps the key format it had before SMTC
/// adapter generalized, so existing cached lyrics and offsets still match.
fn track_key(aumid: &str, artist: &str, title: &str, duration_ms: u64) -> String {
    if aumid.to_lowercase().contains("spotify") {
        format!(
            "smtc::{}::{}",
            urlencoding::encode(&artist.to_lowercase()),
            urlencoding::encode(&title.to_lowercase()),
        )
    } else {
        metadata_key(artist, title, duration_ms)
    }
}

struct ArtworkCache {
    key: String,
    data: Option<Arc<[u8]>>,
}

pub struct SmtcAdapter {
    /// Last good observation per session; reused on transient WinRT errors.
    last: Mutex<HashMap<String, SessionObservation>>,
    /// Thumbnail per session, fetched only when the track changes.
    artwork: Mutex<HashMap<String, ArtworkCache>>,
}

impl SmtcAdapter {
    pub fn new() -> Self {
        Self {
            last: Mutex::new(HashMap::new()),
            artwork: Mutex::new(HashMap::new()),
        }
    }

    /// `Ok(None)`: the session is idle. `Err`: transient failure.
    fn observe_session(
        &self,
        session: &GlobalSystemMediaTransportControlsSession,
        aumid: &str,
        id: &str,
        os_current: bool,
    ) -> Result<Option<SessionObservation>, ()> {
        // Media properties fetch is async; block on it.
        let props = session
            .TryGetMediaPropertiesAsync()
            .and_then(|op| op.get())
            .map_err(|_| ())?;
        let title = props.Title().map_err(|_| ())?.to_string();
        let mut artist = props.Artist().map_err(|_| ())?.to_string();
        if artist.is_empty() {
            artist = props
                .AlbumArtist()
                .map(|s| s.to_string())
                .unwrap_or_default();
        }
        let album = props
            .AlbumTitle()
            .ok()
            .map(|s| s.to_string())
            .filter(|s| !s.is_empty());

        let info = session.GetPlaybackInfo().ok();
        let state = match info.as_ref().and_then(|i| i.PlaybackStatus().ok()) {
            Some(s) if s == GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing => {
                PlaybackState::Playing
            }
            Some(s) if s == GlobalSystemMediaTransportControlsSessionPlaybackStatus::Paused => {
                PlaybackState::Paused
            }
            _ => PlaybackState::Stopped,
        };

        // Players show an empty title during ads and loading gaps.
        if title.is_empty() || state == PlaybackState::Stopped {
            return Ok(None);
        }

        let mut caps = info
            .as_ref()
            .map(playback_caps)
            .unwrap_or(PlaybackCaps::NONE);
        caps.raise = can_raise(aumid);
        let rate = info.as_ref().map(playback_rate).unwrap_or(1.0);
        let timeline = session.GetTimelineProperties().ok();
        let duration_ms = timeline
            .as_ref()
            .and_then(|t| t.EndTime().ok())
            .map(|ts| ticks_to_ms(ts.Duration))
            .unwrap_or(0);
        // Apps that never publish a timeline leave EndTime at zero; their
        // position is meaningless.
        let position_ms = timeline
            .as_ref()
            .filter(|_| duration_ms > 0)
            .and_then(|t| extrapolate_position(t, duration_ms, &state, rate));
        let position_quality = if position_ms.is_some() {
            PositionQuality::Extrapolated
        } else {
            caps.seek = false;
            PositionQuality::Missing
        };

        let uri = track_key(aumid, &artist, &title, duration_ms);
        Ok(Some(SessionObservation {
            id: id.to_string(),
            artwork: self.artwork_for(id, &uri, &props),
            snapshot: PlaybackSnapshot {
                track: Some(TrackRef {
                    player: PlayerApp {
                        id: aumid.to_string(),
                        name: display_name(aumid),
                    },
                    transport: Transport::Smtc,
                    uri,
                    native_id: None,
                    file_path: None,
                    from_browser: false,
                    platform: None,
                    kind: MediaKind::Unsure,
                    page_url: None,
                    title,
                    artist,
                    album,
                    duration_ms,
                    artwork_url: None,
                }),
                state,
                position_ms,
                observed_at_ms: now_ms(),
                rate,
                ignored: None,
                position_quality,
                caps,
            },
            os_current,
        }))
    }

    fn artwork_for(
        &self,
        id: &str,
        uri: &str,
        props: &GlobalSystemMediaTransportControlsSessionMediaProperties,
    ) -> Option<ArtworkBytes> {
        let mut cache = self.artwork.lock().unwrap_or_else(|e| e.into_inner());
        let stale = cache.get(id).is_none_or(|c| c.key != uri);
        if stale {
            cache.insert(
                id.to_string(),
                ArtworkCache {
                    key: uri.to_string(),
                    data: fetch_thumbnail(props),
                },
            );
        }
        let entry = cache.get(id)?;
        let data = entry.data.as_ref()?;
        Some(ArtworkBytes {
            key: entry.key.clone(),
            mime: sniff_image_mime(data),
            data: Arc::clone(data),
        })
    }
}

impl Default for SmtcAdapter {
    fn default() -> Self {
        Self::new()
    }
}

impl PlayerAdapter for SmtcAdapter {
    fn transport(&self) -> Transport {
        Transport::Smtc
    }

    fn sessions(&self) -> Vec<SessionObservation> {
        ensure_com();
        let mut last = self.last.lock().unwrap_or_else(|e| e.into_inner());
        let Some(manager) = session_manager() else {
            return last.values().cloned().collect();
        };
        let Some(sessions) = all_sessions(&manager) else {
            return last.values().cloned().collect();
        };
        let current = manager
            .GetCurrentSession()
            .and_then(|s| s.SourceAppUserModelId())
            .map(|id| id.to_string())
            .ok();

        let mut observed = Vec::new();
        for (session, aumid, ordinal) in &sessions {
            let id = session_id(aumid, *ordinal);
            let os_current = *ordinal == 0 && current.as_deref() == Some(aumid.as_str());
            match self.observe_session(session, aumid, &id, os_current) {
                Ok(Some(observation)) => observed.push(observation),
                Ok(None) => {}
                Err(()) => observed.extend(last.get(&id).cloned()),
            }
        }

        *last = observed.iter().map(|o| (o.id.clone(), o.clone())).collect();
        self.artwork
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .retain(|id, _| last.contains_key(id));
        observed
    }

    fn control(&self, session_id: &str, command: PlayerCommand) -> Result<(), ControlError> {
        ensure_com();
        let (aumid, ordinal) = parse_session_id(session_id).ok_or(ControlError::NoSession)?;
        let manager = session_manager().ok_or(ControlError::Failed)?;
        let session = all_sessions(&manager)
            .ok_or(ControlError::Failed)?
            .into_iter()
            .find(|(_, id, n)| id == aumid && *n == ordinal)
            .map(|(session, _, _)| session)
            .ok_or(ControlError::NoSession)?;
        let accepted = match command {
            PlayerCommand::PlayPause => {
                let is_playing = session
                    .GetPlaybackInfo()
                    .and_then(|info| info.PlaybackStatus())
                    .map(|s| s == GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing)
                    .unwrap_or(false);
                if is_playing {
                    session.TryPauseAsync().and_then(|op| op.get())
                } else {
                    session.TryPlayAsync().and_then(|op| op.get())
                }
            }
            PlayerCommand::Next => session.TrySkipNextAsync().and_then(|op| op.get()),
            PlayerCommand::Previous => session.TrySkipPreviousAsync().and_then(|op| op.get()),
            // SMTC takes position in 100-nanosecond ticks.
            PlayerCommand::Raise => return raise(aumid),
            PlayerCommand::SeekMs(ms) => session
                .TryChangePlaybackPositionAsync(ms as i64 * 10_000)
                .and_then(|op| op.get()),
        };
        match accepted {
            Ok(true) => Ok(()),
            _ => Err(ControlError::Failed),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_ids_roundtrip_with_ordinals() {
        assert_eq!(session_id("Chrome", 0), "smtc:Chrome");
        assert_eq!(session_id("Chrome", 2), "smtc:Chrome#2");
        assert_eq!(parse_session_id("smtc:Chrome"), Some(("Chrome", 0)));
        assert_eq!(parse_session_id("smtc:Chrome#2"), Some(("Chrome", 2)));
        assert_eq!(parse_session_id("mpris:x"), None);
    }

    #[test]
    fn only_packaged_apps_and_spotify_can_be_raised() {
        assert!(can_raise("AppleInc.AppleMusicWin_nzyj5cx40ttqa!App"));
        assert!(can_raise("Spotify.exe"));
        assert!(!can_raise("Chrome"));
    }

    #[test]
    fn spotify_keeps_its_legacy_cache_key() {
        assert_eq!(
            track_key("Spotify.exe", "The Weeknd", "Blinding Lights", 200_040),
            "smtc::the%20weeknd::blinding%20lights"
        );
        assert_eq!(
            track_key("Chrome", "The Weeknd", "Blinding Lights", 200_040),
            "meta::the%20weeknd::blinding%20lights::200"
        );
    }
}
