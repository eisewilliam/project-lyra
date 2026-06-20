//! Linux Spotify adapter using MPRIS over the user's D-Bus session bus.
//!
//! Spotify exposes playback through `org.mpris.MediaPlayer2.spotify` on
//! Linux. MPRIS is a desktop standard, so this adapter is distribution
//! independent as long as the desktop session has D-Bus and Spotify registers
//! its media player service.

use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use dbus::{
    arg::{self, PropMap},
    blocking::{
        stdintf::org_freedesktop_dbus::{DBus, Properties},
        Connection,
    },
};

use crate::domain::{PlaybackSnapshot, PlaybackState, PlayerSource, TrackRef};
use crate::events::PlayerEvent;
use crate::player::PlayerAdapter;

const DBUS_NAME: &str = "org.freedesktop.DBus";
const DBUS_PATH: &str = "/org/freedesktop/DBus";
const MPRIS_PATH: &str = "/org/mpris/MediaPlayer2";
const MPRIS_PLAYER_IFACE: &str = "org.mpris.MediaPlayer2.Player";
const SPOTIFY_MPRIS_PREFIX: &str = "org.mpris.MediaPlayer2.spotify";
const DBUS_TIMEOUT: Duration = Duration::from_millis(350);

pub struct SpotifyLinuxAdapter {
    last: Mutex<Option<PlaybackSnapshot>>,
    connection: Mutex<Option<Connection>>,
}

impl SpotifyLinuxAdapter {
    pub fn new() -> Self {
        Self {
            last: Mutex::new(None),
            connection: Mutex::new(Connection::new_session().ok()),
        }
    }

    fn with_connection<T>(&self, f: impl FnOnce(&Connection) -> Result<T, ()>) -> Result<T, ()> {
        let mut guard = self.connection.lock().map_err(|_| ())?;

        if guard.is_none() {
            *guard = Connection::new_session().ok();
        }

        let Some(conn) = guard.as_ref() else {
            return Err(());
        };

        match f(conn) {
            Ok(value) => Ok(value),
            Err(()) => {
                *guard = None;
                Err(())
            }
        }
    }

    fn query(&self) -> Result<PlaybackSnapshot, ()> {
        self.with_connection(query_spotify)
    }
}

impl Default for SpotifyLinuxAdapter {
    fn default() -> Self {
        Self::new()
    }
}

impl PlayerAdapter for SpotifyLinuxAdapter {
    fn name(&self) -> &str {
        "spotify-linux-mpris"
    }

    fn source(&self) -> PlayerSource {
        PlayerSource::LinuxMpris
    }

    fn snapshot(&self) -> Option<PlaybackSnapshot> {
        self.last.lock().ok()?.clone()
    }

    fn poll(&self) -> Option<PlayerEvent> {
        let new_snapshot = self.query().unwrap_or_else(|()| stopped_snapshot());
        let mut last_guard = self.last.lock().ok()?;

        let event = derive_event(&last_guard, &new_snapshot);
        *last_guard = Some(new_snapshot);
        event
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn stopped_snapshot() -> PlaybackSnapshot {
    PlaybackSnapshot {
        track: None,
        state: PlaybackState::Stopped,
        position_ms: None,
        observed_at_ms: now_ms(),
    }
}

fn query_spotify(conn: &Connection) -> Result<PlaybackSnapshot, ()> {
    let Some(bus_name) = find_spotify_bus_name(conn).map_err(|_| ())? else {
        return Ok(stopped_snapshot());
    };
    let proxy = conn.with_proxy(bus_name, MPRIS_PATH, DBUS_TIMEOUT);

    let status: String = proxy
        .get(MPRIS_PLAYER_IFACE, "PlaybackStatus")
        .map_err(|_| ())?;
    let state = playback_state_from_mpris(&status);
    if state == PlaybackState::Stopped {
        return Ok(stopped_snapshot());
    }

    let metadata: PropMap = proxy
        .get(MPRIS_PLAYER_IFACE, "Metadata")
        .map_err(|_| ())?;
    let Some(track) = track_from_metadata(&metadata) else {
        return Ok(stopped_snapshot());
    };

    let position_us: Option<i64> = proxy.get(MPRIS_PLAYER_IFACE, "Position").ok();
    let position_ms = extrapolate_position(position_us, track.duration_ms, &state);

    Ok(PlaybackSnapshot {
        track: Some(track),
        state,
        position_ms,
        observed_at_ms: now_ms(),
    })
}

fn find_spotify_bus_name(conn: &Connection) -> Result<Option<String>, dbus::Error> {
    let proxy = conn.with_proxy(DBUS_NAME, DBUS_PATH, DBUS_TIMEOUT);
    let mut names = proxy.list_names()?;
    names.sort();
    Ok(names
        .into_iter()
        .find(|name| name.starts_with(SPOTIFY_MPRIS_PREFIX)))
}

fn playback_state_from_mpris(status: &str) -> PlaybackState {
    match status {
        "Playing" => PlaybackState::Playing,
        "Paused" => PlaybackState::Paused,
        _ => PlaybackState::Stopped,
    }
}

fn track_from_metadata(metadata: &PropMap) -> Option<TrackRef> {
    let title = prop_string(metadata, "xesam:title")?;
    if title.trim().is_empty() {
        return None;
    }

    let artist = prop_string_array(metadata, "xesam:artist")
        .or_else(|| prop_string(metadata, "xesam:artist").map(|s| vec![s]))
        .unwrap_or_default()
        .into_iter()
        .filter(|s| !s.trim().is_empty())
        .collect::<Vec<_>>()
        .join(", ");

    if artist.trim().is_empty() {
        return None;
    }

    let album = prop_string(metadata, "xesam:album").filter(|s| !s.trim().is_empty());
    let duration_ms = prop_i64(metadata, "mpris:length")
        .map(mpris_us_to_ms)
        .unwrap_or(0);
    let artwork_url = prop_string(metadata, "mpris:artUrl").filter(|s| !s.trim().is_empty());
    let uri = track_uri(metadata, &artist, &title);

    Some(TrackRef {
        source: PlayerSource::LinuxMpris,
        uri,
        title,
        artist,
        album,
        duration_ms,
        artwork_url,
    })
}

fn prop_string(metadata: &PropMap, key: &str) -> Option<String> {
    arg::prop_cast::<String>(metadata, key).cloned().or_else(|| {
        metadata
            .get(key)
            .and_then(|value| value.0.as_str())
            .map(str::to_string)
    })
}

fn prop_string_array(metadata: &PropMap, key: &str) -> Option<Vec<String>> {
    if let Some(values) = arg::prop_cast::<Vec<String>>(metadata, key) {
        return Some(values.clone());
    }

    let mut out = Vec::new();
    let iter = metadata.get(key)?.0.as_iter()?;
    for item in iter {
        if let Some(s) = item.as_str() {
            out.push(s.to_string());
        }
    }

    if out.is_empty() {
        None
    } else {
        Some(out)
    }
}

fn prop_i64(metadata: &PropMap, key: &str) -> Option<i64> {
    metadata.get(key).and_then(|value| {
        value
            .0
            .as_i64()
            .or_else(|| value.0.as_u64().and_then(|v| i64::try_from(v).ok()))
    })
}

fn track_uri(metadata: &PropMap, artist: &str, title: &str) -> String {
    prop_string(metadata, "mpris:trackid")
        .and_then(|id| spotify_uri_from_track_id(&id))
        .or_else(|| prop_string(metadata, "xesam:url").and_then(|url| spotify_uri_from_url(&url)))
        .unwrap_or_else(|| {
            format!(
                "mpris::{}::{}",
                urlencoding::encode(&artist.to_lowercase()),
                urlencoding::encode(&title.to_lowercase()),
            )
        })
}

fn spotify_uri_from_track_id(track_id: &str) -> Option<String> {
    if track_id.starts_with("spotify:track:") {
        return Some(track_id.to_string());
    }

    track_id
        .split('/')
        .find(|part| part.len() == 22 && part.chars().all(|c| c.is_ascii_alphanumeric()))
        .map(|id| format!("spotify:track:{id}"))
}

fn spotify_uri_from_url(url: &str) -> Option<String> {
    if url.starts_with("spotify:track:") {
        return Some(url.to_string());
    }

    let marker = "open.spotify.com/track/";
    let (_, tail) = url.split_once(marker)?;
    let id = tail.split(['?', '/', '#']).next()?.trim();
    if id.is_empty() {
        None
    } else {
        Some(format!("spotify:track:{id}"))
    }
}

fn mpris_us_to_ms(us: i64) -> u64 {
    if us <= 0 {
        0
    } else {
        (us as u64) / 1_000
    }
}

fn extrapolate_position(
    position_us: Option<i64>,
    duration_ms: u64,
    state: &PlaybackState,
) -> Option<u64> {
    let mut position_ms = position_us.map(mpris_us_to_ms);
    if *state == PlaybackState::Playing {
        // MPRIS `Position` is read at poll time, so no remote timestamp is
        // available to extrapolate from. The polling loop is frequent enough
        // that returning the observed position keeps lyric sync stable.
        if let Some(pos) = position_ms {
            position_ms = Some(if duration_ms > 0 {
                pos.min(duration_ms)
            } else {
                pos
            });
        }
    }
    position_ms
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

fn send_spotify_method(method: &str) -> bool {
    let conn = match Connection::new_session() {
        Ok(conn) => conn,
        Err(_) => return false,
    };
    let Some(bus_name) = find_spotify_bus_name(&conn).ok().flatten() else {
        return false;
    };
    let proxy = conn.with_proxy(bus_name, MPRIS_PATH, DBUS_TIMEOUT);
    let result: Result<(), dbus::Error> = proxy.method_call(MPRIS_PLAYER_IFACE, method, ());
    result.is_ok()
}

pub fn play_pause() -> bool {
    send_spotify_method("PlayPause")
}

pub fn next_track() -> bool {
    send_spotify_method("Next")
}

pub fn previous_track() -> bool {
    send_spotify_method("Previous")
}

pub fn seek_to_seconds(seconds: f64) -> bool {
    let conn = match Connection::new_session() {
        Ok(conn) => conn,
        Err(_) => return false,
    };
    let Some(bus_name) = find_spotify_bus_name(&conn).ok().flatten() else {
        return false;
    };
    let proxy = conn.with_proxy(bus_name, MPRIS_PATH, DBUS_TIMEOUT);
    let metadata: PropMap = match proxy.get(MPRIS_PLAYER_IFACE, "Metadata") {
        Ok(metadata) => metadata,
        Err(_) => return false,
    };
    let Some(track_id) = prop_string(&metadata, "mpris:trackid") else {
        return false;
    };
    let Ok(track_path) = dbus::Path::new(track_id) else {
        return false;
    };
    let position_us = (seconds * 1_000_000.0) as i64;
    let result: Result<(), dbus::Error> =
        proxy.method_call(MPRIS_PLAYER_IFACE, "SetPosition", (track_path, position_us));
    result.is_ok()
}
