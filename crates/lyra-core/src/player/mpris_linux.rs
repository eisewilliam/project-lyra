//! Linux adapter for MPRIS over the user's D-Bus session bus.
//!
//! MPRIS is the desktop standard: Spotify, browsers playing YouTube Music,
//! VLC, Strawberry, Rhythmbox and most other players register an
//! `org.mpris.MediaPlayer2.*` service. This adapter is distribution
//! independent as long as the desktop session has D-Bus. A missing bus,
//! stopped players and incomplete metadata all mean "no session".

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use dbus::{
    arg::{self, PropMap},
    blocking::{stdintf::org_freedesktop_dbus::Properties, Connection, Proxy},
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

const DBUS_NAME: &str = "org.freedesktop.DBus";
const DBUS_PATH: &str = "/org/freedesktop/DBus";
const MPRIS_PREFIX: &str = "org.mpris.MediaPlayer2.";
const MPRIS_PATH: &str = "/org/mpris/MediaPlayer2";
const MPRIS_ROOT_IFACE: &str = "org.mpris.MediaPlayer2";
const MPRIS_PLAYER_IFACE: &str = "org.mpris.MediaPlayer2.Player";
/// `playerctld` mirrors whichever player was active last; following it would
/// duplicate a real player.
const PLAYERCTLD: &str = "playerctld";
/// KDE re-publishes browser media; browsers usually publish it themselves.
const PLASMA_BROWSER: &str = "plasma-browser-integration";
/// Track ID players use when they have no addressable track.
const NO_TRACK: &str = "/org/mpris/MediaPlayer2/TrackList/NoTrack";
const DBUS_TIMEOUT: Duration = Duration::from_millis(350);
const SESSION_PREFIX: &str = "mpris:";
const MAX_ARTWORK_BYTES: u64 = 10 * 1024 * 1024;

type DbusProxy<'a> = Proxy<'a, &'a Connection>;

struct FileArtwork {
    path: String,
    data: Option<Arc<[u8]>>,
}

pub struct MprisAdapter {
    connection: Mutex<Option<Connection>>,
    /// Human-readable player names (`Identity`) by bus name.
    /// Display name (`Identity`) and `CanRaise`, by bus name.
    identities: Mutex<HashMap<String, (String, bool)>>,
    /// Artwork read from local `file://` URLs, by bus name.
    artwork: Mutex<HashMap<String, FileArtwork>>,
}

impl MprisAdapter {
    pub fn new() -> Self {
        Self {
            connection: Mutex::new(Connection::new_session().ok()),
            identities: Mutex::new(HashMap::new()),
            artwork: Mutex::new(HashMap::new()),
        }
    }

    /// Run `f` on the session bus. A failure drops the connection so the
    /// next call reconnects.
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

    /// The player's display name and whether it supports `Raise`, read
    /// once per bus name from the root interface.
    fn identity(&self, proxy: &DbusProxy<'_>, bus: &str, suffix: &str) -> (String, bool) {
        let mut identities = self.identities.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(identity) = identities.get(bus) {
            return identity.clone();
        }
        let name = proxy
            .get::<String>(MPRIS_ROOT_IFACE, "Identity")
            .ok()
            .filter(|name| !name.trim().is_empty())
            .unwrap_or_else(|| display_name(suffix));
        let can_raise = proxy
            .get::<bool>(MPRIS_ROOT_IFACE, "CanRaise")
            .unwrap_or(false);
        identities.insert(bus.to_string(), (name.clone(), can_raise));
        (name, can_raise)
    }

    /// Read local artwork once per track; remote URLs pass through.
    fn file_artwork(&self, bus: &str, art_url: &str) -> Option<ArtworkBytes> {
        let path = file_url_path(art_url)?;
        let mut cache = self.artwork.lock().unwrap_or_else(|e| e.into_inner());
        if cache.get(bus).is_none_or(|a| a.path != path) {
            let data = std::fs::metadata(&path)
                .ok()
                .filter(|m| m.is_file() && m.len() > 0 && m.len() <= MAX_ARTWORK_BYTES)
                .and_then(|_| std::fs::read(&path).ok())
                .map(Arc::from);
            cache.insert(
                bus.to_string(),
                FileArtwork {
                    path: path.clone(),
                    data,
                },
            );
        }
        let data = cache.get(bus)?.data.as_ref()?;
        Some(ArtworkBytes {
            key: format!("{bus}:{path}"),
            mime: sniff_image_mime(data),
            data: Arc::clone(data),
        })
    }

    fn observe_player(&self, conn: &Connection, bus: &str) -> Option<SessionObservation> {
        let suffix = bus.strip_prefix(MPRIS_PREFIX)?;
        let proxy = conn.with_proxy(bus, MPRIS_PATH, DBUS_TIMEOUT);
        let props: PropMap = proxy.get_all(MPRIS_PLAYER_IFACE).ok()?;

        let state = playback_state_from_mpris(prop_str(&props, "PlaybackStatus")?);
        if state == PlaybackState::Stopped {
            return None;
        }
        let metadata: PropMap = proxy.get(MPRIS_PLAYER_IFACE, "Metadata").ok()?;
        let (name, can_raise) = self.identity(&proxy, bus, suffix);
        let mut track = track_from_metadata(&metadata, suffix, name)?;

        let artwork = track
            .artwork_url
            .as_deref()
            .filter(|url| url.starts_with("file://"))
            .and_then(|url| self.file_artwork(bus, url));
        if track
            .artwork_url
            .as_deref()
            .is_some_and(|url| url.starts_with("file://"))
        {
            // The webview cannot load local files; serve them via lyra-art.
            track.artwork_url = None;
        }

        // `Position` is read at poll time; MPRIS gives no remote timestamp.
        let position_us =
            prop_i64(&props, "Position").or_else(|| proxy.get(MPRIS_PLAYER_IFACE, "Position").ok());
        let position_ms = position_us.map(mpris_us_to_ms).map(|pos| {
            if track.duration_ms > 0 {
                pos.min(track.duration_ms)
            } else {
                pos
            }
        });
        let rate = arg::prop_cast::<f64>(&props, "Rate")
            .copied()
            .filter(|r| r.is_finite() && *r >= 0.0)
            .unwrap_or(1.0);
        let mut caps = playback_caps(&props);
        caps.seek &= position_ms.is_some() && track.duration_ms > 0;
        caps.raise = can_raise;

        Some(SessionObservation {
            id: format!("{SESSION_PREFIX}{bus}"),
            snapshot: PlaybackSnapshot {
                track: Some(track),
                state,
                position_ms,
                observed_at_ms: now_ms(),
                rate,
                ignored: None,
                position_quality: if position_ms.is_some() {
                    PositionQuality::Exact
                } else {
                    PositionQuality::Missing
                },
                caps,
            },
            artwork,
            os_current: false,
        })
    }
}

impl Default for MprisAdapter {
    fn default() -> Self {
        Self::new()
    }
}

impl PlayerAdapter for MprisAdapter {
    fn transport(&self) -> Transport {
        Transport::Mpris
    }

    fn sessions(&self) -> Vec<SessionObservation> {
        let observed = self
            .with_connection(|conn| {
                let names = player_bus_names(conn).map_err(|_| ())?;
                Ok(names
                    .iter()
                    .filter_map(|bus| self.observe_player(conn, bus))
                    .collect::<Vec<_>>())
            })
            .unwrap_or_default();
        let observed = drop_republished_browser_media(observed);

        let live: Vec<String> = observed
            .iter()
            .filter_map(|o| o.id.strip_prefix(SESSION_PREFIX).map(str::to_string))
            .collect();
        self.artwork
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .retain(|bus, _| live.contains(bus));
        observed
    }

    fn control(&self, session_id: &str, command: PlayerCommand) -> Result<(), ControlError> {
        let bus = session_id
            .strip_prefix(SESSION_PREFIX)
            .ok_or(ControlError::NoSession)?
            .to_string();
        self.with_connection(|conn| {
            let proxy = conn.with_proxy(bus.as_str(), MPRIS_PATH, DBUS_TIMEOUT);
            let sent: Result<(), dbus::Error> = match command {
                PlayerCommand::PlayPause => proxy.method_call(MPRIS_PLAYER_IFACE, "PlayPause", ()),
                PlayerCommand::Next => proxy.method_call(MPRIS_PLAYER_IFACE, "Next", ()),
                PlayerCommand::Previous => proxy.method_call(MPRIS_PLAYER_IFACE, "Previous", ()),
                PlayerCommand::Raise => proxy.method_call(MPRIS_ROOT_IFACE, "Raise", ()),
                PlayerCommand::SeekMs(ms) => seek(&proxy, ms as i64 * 1_000),
            };
            sent.map_err(|_| ())
        })
        .map_err(|()| ControlError::Failed)
    }
}

/// `SetPosition` needs the current track's object path; players without one
/// accept a relative `Seek` from the current position instead.
fn seek(proxy: &DbusProxy<'_>, target_us: i64) -> Result<(), dbus::Error> {
    let metadata: PropMap = proxy.get(MPRIS_PLAYER_IFACE, "Metadata")?;
    let track_path = prop_string(&metadata, "mpris:trackid")
        .filter(|id| id != NO_TRACK)
        .and_then(|id| dbus::Path::new(id).ok());
    match track_path {
        Some(path) => proxy.method_call(MPRIS_PLAYER_IFACE, "SetPosition", (path, target_us)),
        None => {
            let current: i64 = proxy.get(MPRIS_PLAYER_IFACE, "Position")?;
            proxy.method_call(MPRIS_PLAYER_IFACE, "Seek", (target_us - current,))
        }
    }
}

fn player_bus_names(conn: &Connection) -> Result<Vec<String>, dbus::Error> {
    let proxy = conn.with_proxy(DBUS_NAME, DBUS_PATH, DBUS_TIMEOUT);
    let (mut names,): (Vec<String>,) = proxy.method_call(DBUS_NAME, "ListNames", ())?;
    names.retain(|name| {
        name.strip_prefix(MPRIS_PREFIX)
            .is_some_and(|suffix| !suffix.starts_with(PLAYERCTLD))
    });
    names.sort();
    Ok(names)
}

/// KDE's browser integration republishes media the browser also publishes.
/// Keep the browser's own session when both report the same track, taking
/// the page URL from the duplicate when the browser omitted it.
fn drop_republished_browser_media(sessions: Vec<SessionObservation>) -> Vec<SessionObservation> {
    let track = |o: &SessionObservation| {
        o.snapshot
            .track
            .as_ref()
            .map(|t| (t.title.clone(), t.artist.clone()))
    };
    let (plasma, mut kept): (Vec<_>, Vec<_>) = sessions
        .into_iter()
        .partition(|o| o.id.contains(PLASMA_BROWSER));
    for duplicate in plasma {
        let key = track(&duplicate);
        let original = kept.iter_mut().find(|o| key.is_some() && track(o) == key);
        match original {
            Some(original) => {
                let url = duplicate.snapshot.track.and_then(|t| t.page_url);
                if let Some(track) = original.snapshot.track.as_mut() {
                    track.page_url = track.page_url.take().or(url);
                }
            }
            None => kept.push(duplicate),
        }
    }
    kept
}

fn playback_state_from_mpris(status: &str) -> PlaybackState {
    match status {
        "Playing" => PlaybackState::Playing,
        "Paused" => PlaybackState::Paused,
        _ => PlaybackState::Stopped,
    }
}

fn playback_caps(props: &PropMap) -> PlaybackCaps {
    let flag = |key: &str, default: bool| {
        arg::prop_cast::<bool>(props, key)
            .copied()
            .unwrap_or(default)
    };
    // CanControl is required by the spec; assume true if a player omits it.
    if !flag("CanControl", true) {
        return PlaybackCaps::NONE;
    }
    PlaybackCaps {
        play_pause: flag("CanPlay", false) || flag("CanPause", false),
        next: flag("CanGoNext", false),
        previous: flag("CanGoPrevious", false),
        seek: flag("CanSeek", false),
        // `CanRaise` lives on the root interface; set by the caller.
        raise: false,
    }
}

fn track_from_metadata(metadata: &PropMap, suffix: &str, name: String) -> Option<TrackRef> {
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

    let album = prop_string(metadata, "xesam:album").filter(|s| !s.trim().is_empty());
    let duration_ms = prop_i64(metadata, "mpris:length")
        .map(mpris_us_to_ms)
        .unwrap_or(0);
    let artwork_url = prop_string(metadata, "mpris:artUrl").filter(|s| !s.trim().is_empty());
    let url = prop_string(metadata, "xesam:url");
    let file_path = url.as_deref().and_then(file_url_path);
    // Browsers (and KDE's browser integration) may publish the page URL.
    let page_url = url.filter(|u| u.starts_with("https://") || u.starts_with("http://"));
    let uri = track_uri(metadata, suffix, &artist, &title, duration_ms);
    let native_id = uri.starts_with("spotify:").then(|| uri.clone());

    Some(TrackRef {
        player: PlayerApp {
            id: suffix.to_string(),
            name,
        },
        transport: Transport::Mpris,
        uri,
        native_id,
        file_path,
        from_browser: false,
        platform: None,
        kind: MediaKind::Unsure,
        page_url,
        title,
        artist,
        album,
        duration_ms,
        artwork_url,
    })
}

/// Cache key. Spotify keeps its native URI, or the key format it had before
/// the adapter generalized, so existing cached lyrics and offsets match.
fn track_uri(
    metadata: &PropMap,
    suffix: &str,
    artist: &str,
    title: &str,
    duration_ms: u64,
) -> String {
    if !suffix.starts_with("spotify") {
        return metadata_key(artist, title, duration_ms);
    }
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

/// Local path of a `file://` URL, percent-decoded.
fn file_url_path(url: &str) -> Option<String> {
    let encoded = url.strip_prefix("file://")?;
    let path = urlencoding::decode(encoded).ok()?.into_owned();
    path.starts_with('/').then_some(path)
}

fn prop_str<'a>(props: &'a PropMap, key: &str) -> Option<&'a str> {
    props.get(key).and_then(|value| value.0.as_str())
}

fn prop_string(metadata: &PropMap, key: &str) -> Option<String> {
    arg::prop_cast::<String>(metadata, key)
        .cloned()
        .or_else(|| prop_str(metadata, key).map(str::to_string))
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

#[cfg(test)]
mod tests {
    use super::*;
    use dbus::arg::{RefArg, Variant};

    fn props(entries: Vec<(&str, Box<dyn RefArg>)>) -> PropMap {
        entries
            .into_iter()
            .map(|(k, v)| (k.to_string(), Variant(v)))
            .collect()
    }

    fn observation(id: &str, title: &str) -> SessionObservation {
        SessionObservation {
            id: id.into(),
            snapshot: PlaybackSnapshot {
                track: Some(TrackRef {
                    title: title.into(),
                    ..TrackRef::fixture("x")
                }),
                ..PlaybackSnapshot::stopped(0)
            },
            artwork: None,
            os_current: false,
        }
    }

    #[test]
    fn caps_follow_mpris_flags() {
        let p = props(vec![
            ("CanPlay", Box::new(true)),
            ("CanGoNext", Box::new(true)),
            ("CanSeek", Box::new(false)),
        ]);
        assert_eq!(
            playback_caps(&p),
            PlaybackCaps {
                play_pause: true,
                next: true,
                previous: false,
                seek: false,
                raise: false,
            }
        );
        let locked = props(vec![
            ("CanControl", Box::new(false)),
            ("CanPlay", Box::new(true)),
        ]);
        assert_eq!(playback_caps(&locked), PlaybackCaps::NONE);
    }

    #[test]
    fn non_spotify_players_use_metadata_keys_and_local_paths() {
        let m = props(vec![
            ("xesam:title", Box::new("Blinding Lights".to_string())),
            ("xesam:artist", Box::new(vec!["The Weeknd".to_string()])),
            ("mpris:length", Box::new(200_040_000i64)),
            (
                "xesam:url",
                Box::new("file:///home/me/Music/Blinding%20Lights.flac".to_string()),
            ),
        ]);
        let track = track_from_metadata(&m, "vlc", "VLC media player".into()).unwrap();
        assert_eq!(track.uri, "meta::the%20weeknd::blinding%20lights::200");
        assert_eq!(track.native_id, None);
        assert_eq!(
            track.file_path.as_deref(),
            Some("/home/me/Music/Blinding Lights.flac")
        );
        assert_eq!(track.player.name, "VLC media player");
    }

    #[test]
    fn spotify_keeps_native_and_legacy_keys() {
        let m = props(vec![
            ("xesam:title", Box::new("Song".to_string())),
            ("xesam:artist", Box::new(vec!["Artist".to_string()])),
            (
                "mpris:trackid",
                Box::new("/com/spotify/track/4uLU6hMCjMI75M1A2tKUQC".to_string()),
            ),
        ]);
        let track = track_from_metadata(&m, "spotify", "Spotify".into()).unwrap();
        assert_eq!(track.uri, "spotify:track:4uLU6hMCjMI75M1A2tKUQC");
        assert!(track.native_id.is_some());
    }

    #[test]
    fn republished_browser_media_is_dropped_only_when_duplicated() {
        let sessions = vec![
            observation("mpris:org.mpris.MediaPlayer2.chromium.instance1", "Song"),
            observation(
                "mpris:org.mpris.MediaPlayer2.plasma-browser-integration",
                "Song",
            ),
            observation("mpris:org.mpris.MediaPlayer2.vlc", "Other"),
        ];
        let mut sessions = sessions;
        sessions[1].snapshot.track.as_mut().unwrap().page_url =
            Some("https://music.youtube.com/watch?v=x".into());
        let kept = drop_republished_browser_media(sessions);
        assert_eq!(kept.len(), 2);
        assert!(kept.iter().all(|o| !o.id.contains(PLASMA_BROWSER)));
        let chromium = kept.iter().find(|o| o.id.contains("chromium")).unwrap();
        assert_eq!(
            chromium
                .snapshot
                .track
                .as_ref()
                .unwrap()
                .page_url
                .as_deref(),
            Some("https://music.youtube.com/watch?v=x")
        );

        let only_plasma = vec![observation(
            "mpris:org.mpris.MediaPlayer2.plasma-browser-integration",
            "Song",
        )];
        assert_eq!(drop_republished_browser_media(only_plasma).len(), 1);
    }

    #[test]
    fn file_urls_decode_and_reject_non_files() {
        assert_eq!(
            file_url_path("file:///tmp/a%20b.png").as_deref(),
            Some("/tmp/a b.png")
        );
        assert_eq!(file_url_path("https://example.com/a.png"), None);
    }
}
