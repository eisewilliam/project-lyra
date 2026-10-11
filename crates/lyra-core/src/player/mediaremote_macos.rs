//! macOS Now Playing adapter (MediaRemote): browsers such as YouTube Music
//! in Chrome or Safari, and any other app that publishes Now Playing info.
//!
//! macOS 15.4+ serves MediaRemote data only to entitled processes. The
//! system Perl is entitled, so the vendored mediaremote-adapter script runs
//! inside `/usr/bin/perl` and loads `MediaRemoteAdapter.framework`, which the
//! host bundles. One long-lived `stream` process feeds a reader thread;
//! polls read its latest state without blocking. MediaRemote reports only
//! the app macOS considers "now playing", and commands always reach that app.

use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, ChildStdout, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Deserialize;
use serde_json::{Map, Value};

use crate::domain::{
    MediaKind, PlaybackCaps, PlaybackSnapshot, PlaybackState, PlayerApp, PositionQuality, TrackRef,
    Transport,
};
use crate::player::metadata::{display_name, metadata_key};
use crate::player::{
    macos_open, now_ms, sniff_image_mime, ArtworkBytes, ControlError, PlayerAdapter, PlayerCommand,
    SessionObservation,
};

/// Vendored upstream script; passed to Perl with `-e` so no script file
/// needs to ship next to the framework.
const SCRIPT: &str =
    include_str!("../../../../native/macos-sidecar/mediaremote-adapter/bin/mediaremote-adapter.pl");
const PERL: &str = "/usr/bin/perl";
const SESSION_PREFIX: &str = "mediaremote:";
const INITIAL_BACKOFF: Duration = Duration::from_secs(1);
const MAX_BACKOFF: Duration = Duration::from_secs(60);
/// A stream that ran this long was healthy; restart it without backoff.
const HEALTHY_RUN: Duration = Duration::from_secs(30);
const COMMAND_TIMEOUT: Duration = Duration::from_secs(3);
const MAX_ARTWORK_BYTES: usize = 10 * 1024 * 1024;

/// MRCommand IDs understood by the adapter's `send` function.
const CMD_TOGGLE_PLAY_PAUSE: &str = "2";
const CMD_NEXT_TRACK: &str = "4";
const CMD_PREVIOUS_TRACK: &str = "5";

/// Latest merged Now Playing payload from the stream.
#[derive(Default)]
struct Shared {
    payload: Map<String, Value>,
    artwork: Option<Arc<[u8]>>,
    /// Incremented per stream process so a finished process's reader
    /// thread never touches a newer process's state.
    generation: u64,
}

impl Shared {
    fn clear(&mut self) {
        self.payload.clear();
        self.artwork = None;
    }
}

struct Supervisor {
    child: Option<Child>,
    started_at: Instant,
    next_start: Instant,
    backoff: Duration,
    stopped: bool,
}

pub struct MediaRemoteAdapter {
    framework: PathBuf,
    shared: Arc<Mutex<Shared>>,
    supervisor: Mutex<Supervisor>,
}

impl MediaRemoteAdapter {
    /// `framework` is the bundled `MediaRemoteAdapter.framework` directory.
    pub fn new(framework: PathBuf) -> Self {
        let now = Instant::now();
        Self {
            framework,
            shared: Arc::new(Mutex::new(Shared::default())),
            supervisor: Mutex::new(Supervisor {
                child: None,
                started_at: now,
                next_start: now,
                backoff: INITIAL_BACKOFF,
                stopped: false,
            }),
        }
    }

    fn command(&self, args: &[&str]) -> Command {
        let mut command = Command::new(PERL);
        command
            .arg("-e")
            .arg(SCRIPT)
            .arg(&self.framework)
            .args(args)
            // An empty environment keeps PERL5LIB/PERL5OPT from injecting
            // code into the entitled interpreter.
            .env_clear()
            .stdin(Stdio::null())
            .stderr(Stdio::null());
        command
    }

    /// Start or restart the stream process, with backoff after failures.
    fn ensure_stream(&self) {
        let mut sup = self.supervisor.lock().unwrap_or_else(|e| e.into_inner());
        if sup.stopped {
            return;
        }
        if let Some(child) = sup.child.as_mut() {
            if matches!(child.try_wait(), Ok(None)) {
                return;
            }
            let _ = child.wait();
            sup.child = None;
            if sup.started_at.elapsed() >= HEALTHY_RUN {
                sup.backoff = INITIAL_BACKOFF;
                sup.next_start = Instant::now();
            }
        }
        let now = Instant::now();
        if now < sup.next_start {
            return;
        }
        sup.started_at = now;
        sup.next_start = now + sup.backoff;
        sup.backoff = (sup.backoff * 2).min(MAX_BACKOFF);

        let spawned = self
            .command(&["stream", "--micros", "--debounce=100"])
            .stdout(Stdio::piped())
            .spawn();
        let Ok(mut child) = spawned else {
            return;
        };
        let Some(stdout) = child.stdout.take() else {
            let _ = child.kill();
            return;
        };
        let generation = {
            let mut state = self.shared.lock().unwrap_or_else(|e| e.into_inner());
            state.clear();
            state.generation += 1;
            state.generation
        };
        let shared = Arc::clone(&self.shared);
        let reader = std::thread::Builder::new()
            .name("lyra-mediaremote".into())
            .spawn(move || read_stream(stdout, &shared, generation));
        if reader.is_err() {
            let _ = child.kill();
            return;
        }
        sup.child = Some(child);
    }
}

#[derive(Deserialize)]
struct StreamLine {
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    diff: bool,
    #[serde(default)]
    payload: Map<String, Value>,
}

fn read_stream(stdout: ChildStdout, shared: &Mutex<Shared>, generation: u64) {
    for line in BufReader::new(stdout).lines() {
        let Ok(line) = line else { break };
        let Ok(message) = serde_json::from_str::<StreamLine>(&line) else {
            continue;
        };
        if message.kind != "data" {
            continue;
        }
        let mut state = shared.lock().unwrap_or_else(|e| e.into_inner());
        if state.generation != generation {
            return;
        }
        apply_update(&mut state, message.diff, message.payload);
    }
    // The process ended: whatever it last reported is no longer current.
    let mut state = shared.lock().unwrap_or_else(|e| e.into_inner());
    if state.generation == generation {
        state.clear();
    }
}

/// Merge one stream message. Full messages replace the state; diffs update
/// keys, and `null` removes a key. Artwork is decoded once here.
fn apply_update(state: &mut Shared, diff: bool, payload: Map<String, Value>) {
    if !diff {
        state.clear();
    }
    for (key, value) in payload {
        if key == "artworkData" {
            state.artwork = value
                .as_str()
                .and_then(|b64| STANDARD.decode(b64).ok())
                .filter(|data| !data.is_empty() && data.len() <= MAX_ARTWORK_BYTES)
                .map(Arc::from);
        } else if value.is_null() {
            state.payload.remove(&key);
        } else {
            state.payload.insert(key, value);
        }
    }
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct NowPlaying {
    bundle_identifier: Option<String>,
    parent_application_bundle_identifier: Option<String>,
    playing: Option<bool>,
    title: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    duration_micros: Option<f64>,
    elapsed_time_micros: Option<f64>,
    timestamp_epoch_micros: Option<f64>,
    playback_rate: Option<f64>,
}

fn micros_to_ms(micros: f64) -> Option<u64> {
    (micros.is_finite() && micros >= 0.0).then(|| (micros / 1000.0) as u64)
}

/// Build the session from the merged payload. Pure for testing.
fn observation(
    payload: &Map<String, Value>,
    artwork: Option<&Arc<[u8]>>,
    now_ms: u64,
) -> Option<SessionObservation> {
    let np: NowPlaying = serde_json::from_value(Value::Object(payload.clone())).ok()?;
    let title = np.title.filter(|t| !t.trim().is_empty())?;
    // Web content can be published by a helper process; the parent is the
    // app the user sees.
    let app_id = np
        .parent_application_bundle_identifier
        .or(np.bundle_identifier)
        .filter(|id| !id.is_empty())?;
    let artist = np.artist.unwrap_or_default();
    let album = np.album.filter(|a| !a.trim().is_empty());
    let duration_ms = np.duration_micros.and_then(micros_to_ms).unwrap_or(0);
    let playing = np.playing.unwrap_or(false);
    let position_ms = np.elapsed_time_micros.and_then(micros_to_ms);
    let rate = np
        .playback_rate
        .filter(|r| r.is_finite() && *r >= 0.0)
        .unwrap_or(1.0);
    let uri = metadata_key(&artist, &title, duration_ms);

    Some(SessionObservation {
        id: format!("{SESSION_PREFIX}{app_id}"),
        artwork: artwork.map(|data| ArtworkBytes {
            key: uri.clone(),
            mime: sniff_image_mime(data),
            data: Arc::clone(data),
        }),
        snapshot: PlaybackSnapshot {
            track: Some(TrackRef {
                player: PlayerApp {
                    name: display_name(&app_id),
                    id: app_id,
                },
                transport: Transport::MediaRemote,
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
            state: if playing {
                PlaybackState::Playing
            } else {
                PlaybackState::Paused
            },
            position_ms,
            // `elapsedTime` is the position at `timestamp`; the runtime
            // extrapolates from there.
            observed_at_ms: np
                .timestamp_epoch_micros
                .and_then(micros_to_ms)
                .unwrap_or(now_ms),
            rate,
            ignored: None,
            position_quality: if position_ms.is_some() {
                PositionQuality::Extrapolated
            } else {
                PositionQuality::Missing
            },
            caps: PlaybackCaps {
                seek: position_ms.is_some() && duration_ms > 0,
                ..PlaybackCaps::ALL
            },
        },
        // MediaRemote only reports the app macOS considers now playing.
        os_current: true,
    })
}

impl PlayerAdapter for MediaRemoteAdapter {
    fn transport(&self) -> Transport {
        Transport::MediaRemote
    }

    fn sessions(&self) -> Vec<SessionObservation> {
        self.ensure_stream();
        let shared = self.shared.lock().unwrap_or_else(|e| e.into_inner());
        observation(&shared.payload, shared.artwork.as_ref(), now_ms())
            .into_iter()
            .collect()
    }

    fn control(&self, session_id: &str, command: PlayerCommand) -> Result<(), ControlError> {
        if !session_id.starts_with(SESSION_PREFIX) {
            return Err(ControlError::NoSession);
        }
        let seek_micros;
        let args: [&str; 2] = match command {
            PlayerCommand::PlayPause => ["send", CMD_TOGGLE_PLAY_PAUSE],
            PlayerCommand::Next => ["send", CMD_NEXT_TRACK],
            PlayerCommand::Previous => ["send", CMD_PREVIOUS_TRACK],
            PlayerCommand::SeekMs(ms) => {
                seek_micros = (ms * 1000).to_string();
                ["seek", &seek_micros]
            }
            PlayerCommand::Raise => {
                // Activating the app by bundle ID brings an installed web app
                // (e.g. YouTube Music) or the browser window forward.
                let bundle = &session_id[SESSION_PREFIX.len()..];
                return if macos_open(&["-b", bundle]) {
                    Ok(())
                } else {
                    Err(ControlError::Failed)
                };
            }
        };
        let mut child = self
            .command(&args)
            .stdout(Stdio::null())
            .spawn()
            .map_err(|_| ControlError::Failed)?;
        let deadline = Instant::now() + COMMAND_TIMEOUT;
        loop {
            match child.try_wait() {
                Ok(Some(status)) if status.success() => return Ok(()),
                Ok(Some(_)) | Err(_) => return Err(ControlError::Failed),
                Ok(None) if Instant::now() >= deadline => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(ControlError::Failed);
                }
                Ok(None) => std::thread::sleep(Duration::from_millis(10)),
            }
        }
    }

    fn shutdown(&self) {
        let mut sup = self.supervisor.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(mut child) = sup.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        sup.stopped = true;
    }
}

impl Drop for MediaRemoteAdapter {
    fn drop(&mut self) {
        self.shutdown();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn payload(value: Value) -> Map<String, Value> {
        value.as_object().unwrap().clone()
    }

    #[test]
    fn browser_payload_becomes_an_extrapolated_session() {
        let p = payload(json!({
            "bundleIdentifier": "com.google.Chrome",
            "playing": true,
            "title": "Blinding Lights",
            "artist": "The Weeknd",
            "album": "After Hours",
            "durationMicros": 200_040_000.0,
            "elapsedTimeMicros": 42_000_000.0,
            "timestampEpochMicros": 1_791_576_423_869_494.0,
            "playbackRate": 1.0
        }));
        let obs = observation(&p, None, 5).unwrap();
        let track = obs.snapshot.track.as_ref().unwrap();
        assert_eq!(obs.id, "mediaremote:com.google.Chrome");
        assert_eq!(track.player.name, "Google Chrome");
        assert_eq!(track.uri, "meta::the%20weeknd::blinding%20lights::200");
        assert_eq!(obs.snapshot.state, PlaybackState::Playing);
        assert_eq!(obs.snapshot.position_ms, Some(42_000));
        assert_eq!(obs.snapshot.observed_at_ms, 1_791_576_423_869);
        assert_eq!(obs.snapshot.position_quality, PositionQuality::Extrapolated);
        assert!(obs.snapshot.caps.seek);
        assert!(obs.os_current);
    }

    #[test]
    fn parent_app_and_missing_position_are_handled() {
        let p = payload(json!({
            "bundleIdentifier": "com.apple.WebKit.GPU",
            "parentApplicationBundleIdentifier": "com.apple.Safari",
            "playing": false,
            "title": "Song"
        }));
        let obs = observation(&p, None, 7).unwrap();
        assert_eq!(obs.id, "mediaremote:com.apple.Safari");
        assert_eq!(obs.snapshot.state, PlaybackState::Paused);
        assert_eq!(obs.snapshot.position_ms, None);
        assert_eq!(obs.snapshot.observed_at_ms, 7);
        assert_eq!(obs.snapshot.position_quality, PositionQuality::Missing);
        assert!(!obs.snapshot.caps.seek);
    }

    #[test]
    fn empty_payload_means_no_session() {
        assert!(observation(&Map::new(), None, 0).is_none());
        let untitled = payload(json!({ "bundleIdentifier": "x", "title": "  " }));
        assert!(observation(&untitled, None, 0).is_none());
    }

    #[test]
    fn diffs_merge_and_remove_keys_and_decode_artwork() {
        let mut state = Shared::default();
        apply_update(
            &mut state,
            false,
            payload(json!({ "title": "A", "artist": "X", "artworkData": STANDARD.encode(b"img") })),
        );
        assert_eq!(state.artwork.as_deref(), Some(&b"img"[..]));
        apply_update(
            &mut state,
            true,
            payload(json!({ "title": "B", "artist": null })),
        );
        assert_eq!(state.payload.get("title"), Some(&json!("B")));
        assert!(!state.payload.contains_key("artist"));
        assert!(state.artwork.is_some(), "diff without artwork keeps it");
        apply_update(&mut state, true, payload(json!({ "artworkData": null })));
        assert!(state.artwork.is_none());
        apply_update(&mut state, false, payload(json!({ "title": "C" })));
        assert_eq!(state.payload.len(), 1);
    }
}
