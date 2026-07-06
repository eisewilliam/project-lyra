use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

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
        const SCRIPT: &str = r#"
if application "Spotify" is not running then return "not_running"
tell application "Spotify"
    set ps to player state as string
    if ps is "stopped" then return "stopped"
    set tid to id of current track
    set pos to player position
    return ps & "|" & tid & "|" & (pos as string)
end tell
"#;
        let raw = run_compiled_script(&LITE_SCRIPT, SCRIPT)?;
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
        const SCRIPT: &str = r#"
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
        let raw = run_compiled_script(&META_SCRIPT, SCRIPT)?;
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

use objc::runtime::Object;
use objc::{class, msg_send, sel, sel_impl};

/// Wraps a raw NSAppleScript pointer that lives for the process lifetime.
/// AppleScript objects are not formally thread-safe per Apple docs, but our
/// polling driver runs handlers serially on a single GCD queue, so reuse is
/// safe in practice. The Send/Sync impls reflect that contract.
struct CompiledScript {
    ptr: *mut Object,
}

unsafe impl Send for CompiledScript {}
unsafe impl Sync for CompiledScript {}

static LITE_SCRIPT: OnceLock<CompiledScript> = OnceLock::new();
static META_SCRIPT: OnceLock<CompiledScript> = OnceLock::new();
static PLAY_PAUSE_SCRIPT: OnceLock<CompiledScript> = OnceLock::new();
static NEXT_TRACK_SCRIPT: OnceLock<CompiledScript> = OnceLock::new();
static PREVIOUS_TRACK_SCRIPT: OnceLock<CompiledScript> = OnceLock::new();

/// Compile an AppleScript source string once into a retained NSAppleScript
/// instance. The returned pointer is kept alive for the process lifetime via
/// `OnceLock` — never released.
fn compile_script(source: &str) -> Option<*mut Object> {
    unsafe {
        let pool: *mut Object = msg_send![class!(NSAutoreleasePool), new];
        let bytes = source.as_bytes();
        let str_alloc: *mut Object = msg_send![class!(NSString), alloc];
        let src_str: *mut Object = msg_send![
            str_alloc,
            initWithBytes: bytes.as_ptr()
            length: bytes.len()
            encoding: 4u64
        ];
        let s_alloc: *mut Object = msg_send![class!(NSAppleScript), alloc];
        let script: *mut Object = msg_send![s_alloc, initWithSource: src_str];
        let _: () = msg_send![src_str, release];

        if script.is_null() {
            let _: () = msg_send![pool, drain];
            return None;
        }

        // Pre-compile so the first execute call doesn't pay the parse cost.
        let mut compile_err: *mut Object = std::ptr::null_mut();
        let _: bool = msg_send![script, compileAndReturnError: &mut compile_err];

        let _: () = msg_send![pool, drain];
        Some(script)
    }
}

/// Execute a compiled NSAppleScript and return its `stringValue` result.
fn execute_compiled(script_ptr: *mut Object) -> Option<String> {
    if script_ptr.is_null() {
        return None;
    }
    unsafe {
        let pool: *mut Object = msg_send![class!(NSAutoreleasePool), new];
        let mut err_ptr: *mut Object = std::ptr::null_mut();
        let desc: *mut Object = msg_send![script_ptr, executeAndReturnError: &mut err_ptr];
        if desc.is_null() {
            let _: () = msg_send![pool, drain];
            return None;
        }
        let val: *mut Object = msg_send![desc, stringValue];
        if val.is_null() {
            let _: () = msg_send![pool, drain];
            return None;
        }
        let utf8: *const std::ffi::c_char = msg_send![val, UTF8String];
        if utf8.is_null() {
            let _: () = msg_send![pool, drain];
            return None;
        }
        let c_str = std::ffi::CStr::from_ptr(utf8);
        let res = c_str.to_string_lossy().trim().to_string();
        let _: () = msg_send![pool, drain];
        Some(res)
    }
}

/// Get-or-init the cached compiled script and execute it. Compilation runs
/// once per process; subsequent calls skip the parse stage entirely.
fn run_compiled_script(slot: &OnceLock<CompiledScript>, source: &str) -> Option<String> {
    let script = slot.get_or_init(|| CompiledScript {
        ptr: compile_script(source).unwrap_or(std::ptr::null_mut()),
    });
    execute_compiled(script.ptr)
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

fn run_command_compiled(slot: &OnceLock<CompiledScript>, source: &str) -> bool {
    let script = slot.get_or_init(|| CompiledScript {
        ptr: compile_script(source).unwrap_or(std::ptr::null_mut()),
    });
    if script.ptr.is_null() {
        return false;
    }
    unsafe {
        let pool: *mut Object = msg_send![class!(NSAutoreleasePool), new];
        let mut err_ptr: *mut Object = std::ptr::null_mut();
        let desc: *mut Object = msg_send![script.ptr, executeAndReturnError: &mut err_ptr];
        let success = !desc.is_null() && err_ptr.is_null();
        let _: () = msg_send![pool, drain];
        success
    }
}

pub fn play_pause() -> bool {
    const SCRIPT: &str = r#"
if application "Spotify" is not running then return "false"
tell application "Spotify" to playpause
return "true"
"#;
    run_command_compiled(&PLAY_PAUSE_SCRIPT, SCRIPT)
}

pub fn next_track() -> bool {
    const SCRIPT: &str = r#"
if application "Spotify" is not running then return "false"
tell application "Spotify" to next track
return "true"
"#;
    run_command_compiled(&NEXT_TRACK_SCRIPT, SCRIPT)
}

pub fn previous_track() -> bool {
    const SCRIPT: &str = r#"
if application "Spotify" is not running then return "false"
tell application "Spotify" to previous track
return "true"
"#;
    run_command_compiled(&PREVIOUS_TRACK_SCRIPT, SCRIPT)
}

/// Seek to a position in seconds (Spotify's `player position` is seconds, double).
pub fn seek_to_seconds(seconds: f64) -> bool {
    let source = format!(
        "if application \"Spotify\" is not running then return \"false\"\ntell application \"Spotify\" to set player position to {}\nreturn \"true\"",
        seconds
    );
    if let Some(script_ptr) = compile_script(&source) {
        unsafe {
            let pool: *mut Object = msg_send![class!(NSAutoreleasePool), new];
            let mut err_ptr: *mut Object = std::ptr::null_mut();
            let desc: *mut Object = msg_send![script_ptr, executeAndReturnError: &mut err_ptr];
            let success = !desc.is_null() && err_ptr.is_null();
            let _: () = msg_send![script_ptr, release];
            let _: () = msg_send![pool, drain];
            success
        }
    } else {
        false
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
                    album: if m.album.is_empty() {
                        None
                    } else {
                        Some(m.album)
                    },
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
