mod commands;
mod linux;
mod macos;
mod menu;
mod tray;
mod ui_state;
mod updater;

use lyra_core::domain::{BrowserLyrics, PlaybackState};
use lyra_core::lyrics::refresh::LyricsRefresh;
use lyra_core::player::hub::PlayerHub;
use lyra_core::player::PlayerAdapter;
use lyra_core::runtime::LyraRuntime;
use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use tauri::{Emitter, EventTarget, Manager};
use ui_state::{UiState, UiStateStore};

/// Custom URI scheme serving artwork that players expose only as bytes.
const ARTWORK_SCHEME: &str = "lyra-art";

/// Re-poll interval while a track change waits for stable metadata.
const SETTLE_REPOLL_MS: u64 = 100;

pub struct AppState {
    pub runtime: Mutex<LyraRuntime>,
    /// Core provider coordinator; network requests run outside the runtime lock.
    pub lyrics: LyricsRefresh,
    /// Platform player adapters and session selection. Polled and controlled
    /// outside the runtime lock.
    pub players: Arc<PlayerHub>,
    pub ui: UiStateStore,
    /// Transient, non-persisted visibility. Windows start hidden in
    /// tauri.conf.json, and auto-hide can hide a surface without changing the
    /// user's persisted "show this surface" preference.
    pub surface_visibility: RuntimeSurfaceVisibility,
    /// Wakes the poll loop for an immediate adapter poll.
    pub poll: PollTrigger,
}

/// Lets commands request an immediate adapter poll — after a transport
/// control or when a surface becomes visible again — instead of waiting for
/// the next scheduled tick (up to 10 s while everything is hidden).
#[derive(Default)]
pub struct PollTrigger {
    wake: Mutex<Option<Box<dyn Fn() + Send + Sync>>>,
}

impl PollTrigger {
    pub fn request_poll(&self) {
        if let Ok(wake) = self.wake.lock() {
            if let Some(wake) = wake.as_ref() {
                wake();
            }
        }
    }

    fn install(&self, wake: impl Fn() + Send + Sync + 'static) {
        if let Ok(mut slot) = self.wake.lock() {
            *slot = Some(Box::new(wake));
        }
    }
}

pub struct RuntimeSurfaceVisibility {
    hidden_surfaces: Mutex<HashSet<String>>,
    ready_surfaces: Mutex<HashSet<String>>,
    /// Surfaces whose page reports itself hidden: minimized, fully covered,
    /// on another Space, or behind a locked screen.
    occluded_surfaces: Mutex<HashSet<String>>,
}

impl RuntimeSurfaceVisibility {
    fn new_all_hidden() -> Self {
        Self {
            hidden_surfaces: Mutex::new(
                ["main", "island", "karaoke"]
                    .into_iter()
                    .map(String::from)
                    .collect(),
            ),
            ready_surfaces: Mutex::new(HashSet::new()),
            occluded_surfaces: Mutex::new(HashSet::new()),
        }
    }

    pub fn set_occluded(&self, label: &str, occluded: bool) {
        let Ok(mut set) = self.occluded_surfaces.lock() else {
            return;
        };
        if occluded {
            set.insert(label.to_string());
        } else {
            set.remove(label);
        }
    }

    pub fn set_visible(&self, label: &str, visible: bool) {
        let Ok(mut hidden) = self.hidden_surfaces.lock() else {
            return;
        };
        if visible {
            hidden.remove(label);
        } else {
            hidden.insert(label.to_string());
        }
    }

    pub fn set_ready(&self, label: &str) {
        let Ok(mut ready) = self.ready_surfaces.lock() else {
            return;
        };
        ready.insert(label.to_string());
    }

    pub fn is_visible(&self, label: &str, configured_visible: bool) -> bool {
        if !configured_visible {
            return false;
        }

        let is_occluded = self
            .occluded_surfaces
            .lock()
            .map(|set| set.contains(label))
            .unwrap_or(false);
        if is_occluded {
            return false;
        }

        let is_ready = self
            .ready_surfaces
            .lock()
            .map(|ready| ready.contains(label))
            .unwrap_or(false);

        if !is_ready {
            // During startup, if a surface is configured to be visible but has not yet
            // called window_ready, we treat it as visible to allow early polling.
            return true;
        }

        self.hidden_surfaces
            .lock()
            .map(|hidden| !hidden.contains(label))
            .unwrap_or(configured_visible)
    }
}

/// Player adapters available on this OS. See `docs/PLAYER_SUPPORT.md`.
fn platform_adapters() -> Vec<Box<dyn PlayerAdapter>> {
    #[cfg(target_os = "macos")]
    {
        use lyra_core::player::{apple_music_macos, mediaremote_macos, spotify_macos};
        let mut adapters: Vec<Box<dyn PlayerAdapter>> = vec![
            Box::new(spotify_macos::SpotifyMacOsAdapter::new()),
            Box::new(apple_music_macos::AppleMusicMacOsAdapter::new()),
        ];
        match mediaremote_framework() {
            Some(framework) => adapters.push(Box::new(mediaremote_macos::MediaRemoteAdapter::new(
                framework,
            ))),
            None => {
                log::warn!("MediaRemoteAdapter.framework not found; Now Playing apps unavailable")
            }
        }
        adapters
    }
    #[cfg(target_os = "windows")]
    {
        vec![Box::new(lyra_core::player::smtc_windows::SmtcAdapter::new())]
    }
    #[cfg(target_os = "linux")]
    {
        vec![Box::new(lyra_core::player::mpris_linux::MprisAdapter::new())]
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        Vec::new()
    }
}

/// The MediaRemote adapter framework sits in `../Frameworks` relative to the
/// executable both in the app bundle and in development, where
/// `tauri-build` copies it to `target/Frameworks`.
#[cfg(target_os = "macos")]
fn mediaremote_framework() -> Option<std::path::PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let framework = exe
        .parent()?
        .parent()?
        .join("Frameworks/MediaRemoteAdapter.framework");
    framework.exists().then_some(framework)
}

/// URL prefix the webview uses for `ARTWORK_SCHEME`. WebView2 serves custom
/// schemes as `http://<scheme>.localhost/`; WKWebView and WebKitGTK use the
/// scheme directly.
fn artwork_base_url() -> String {
    if cfg!(target_os = "windows") {
        format!("http://{ARTWORK_SCHEME}.localhost/")
    } else {
        format!("{ARTWORK_SCHEME}://localhost/")
    }
}

fn artwork_response(
    app: &tauri::AppHandle,
    request: &tauri::http::Request<Vec<u8>>,
) -> tauri::http::Response<Vec<u8>> {
    use tauri::http::{header, Response, StatusCode};
    let id = request.uri().path().trim_start_matches('/');
    let blob = app
        .try_state::<AppState>()
        .and_then(|state| state.players.artwork(id));
    match blob {
        Some(blob) => Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, blob.mime)
            .header(header::CACHE_CONTROL, "no-store")
            .body(blob.data.to_vec()),
        None => Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Vec::new()),
    }
    .unwrap_or_else(|_| Response::new(Vec::new()))
}

/// Poll the hub and start any background lyric lookups it asked for. The
/// lookups settle whether unsure browser media is music; results land in
/// the lyric cache and apply on a later poll.
fn poll_players(
    app: &tauri::AppHandle,
    players: &PlayerHub,
) -> lyra_core::domain::PlaybackSnapshot {
    let snapshot = players.poll();
    for track in players.take_probes() {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            if let Some(state) = app.try_state::<AppState>() {
                let _ = state.lyrics.probe(&state.runtime, &track).await;
            }
        });
    }
    snapshot
}

/// Poll players now and broadcast a fresh snapshot, so rule, override and
/// consent changes apply without waiting for the next scheduled poll.
/// Adapter calls run on the blocking pool.
pub(crate) async fn refresh_playback(app: tauri::AppHandle) {
    let _ = tauri::async_runtime::spawn_blocking(move || {
        let Some(state) = app.try_state::<AppState>() else {
            return;
        };
        let snapshot = poll_players(&app, &state.players);
        let render = {
            let mut rt = state.runtime.lock().unwrap_or_else(|e| e.into_inner());
            rt.set_playback_snapshot(snapshot);
            rt.tick()
        };
        let _ = app.emit("playback-tick", render);
    })
    .await;
}

/// Fire-and-forget `refresh_playback` for synchronous commands.
pub(crate) fn refresh_playback_now(app: &tauri::AppHandle) {
    tauri::async_runtime::spawn(refresh_playback(app.clone()));
}

/// True when the player adapters should be polled on this wakeup: the
/// configured interval elapsed, or a track change is waiting to settle and
/// the settle re-poll interval elapsed. Lyric-transition wakeups in between
/// never reach the adapters.
fn player_poll_due(handle: &tauri::AppHandle, elapsed_ms: u64, interval_ms: u64) -> bool {
    elapsed_ms >= interval_ms
        || (elapsed_ms >= SETTLE_REPOLL_MS
            && handle
                .try_state::<AppState>()
                .is_some_and(|state| state.players.is_settling()))
}

fn app_support_dir() -> std::path::PathBuf {
    // One host-owned path is injected into every persistence store.
    dirs_next::data_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("lyra")
}

fn migrate_app_support_dir() {
    let base = dirs_next::data_dir().unwrap_or_else(|| std::path::PathBuf::from("."));
    let old_dir = base.join("Lyra");
    let new_dir = base.join("lyra");

    if !old_dir.exists() || new_dir.exists() {
        return;
    }

    let _ = std::fs::rename(&old_dir, &new_dir);
}

/// Move all surfaces onto the user's preferred monitor (or the primary monitor
/// when no preference is set). Called once at startup and again whenever the
/// `preferred_monitor` setting changes.
///
/// Positioning rules:
/// - **Island**: top-centred on the target monitor, unless the user has an
///   explicit saved position (`island_pos` is `Some`), in which case we leave
///   it untouched.
/// - **Main window**: centred on the target monitor.
/// - **Karaoke**: positioned at the configured screen-edge (top or bottom) of
///   the target monitor, respecting `karaoke_offset_px`.
pub(crate) fn apply_preferred_monitor_positioning(app: &tauri::AppHandle, ui: &UiState) {
    // We need a window handle to query the system monitor list.
    let Some(ref_win) = app
        .get_webview_window("main")
        .or_else(|| app.get_webview_window("island"))
        .or_else(|| app.get_webview_window("settings"))
    else {
        return;
    };

    let Ok(all_monitors) = ref_win.available_monitors() else {
        return;
    };
    if all_monitors.is_empty() {
        return;
    }

    // Primary monitor position for fallback matching.
    let primary_pos: Option<(i32, i32)> = ref_win
        .primary_monitor()
        .ok()
        .flatten()
        .map(|m| (m.position().x, m.position().y));

    // Pick the target: preferred by name → primary → first available.
    let target = ui
        .preferred_monitor
        .as_deref()
        .and_then(|name| {
            all_monitors
                .iter()
                .find(|m| m.name().map(|s| s.as_str()) == Some(name))
        })
        .or_else(|| {
            primary_pos.and_then(|(px, py)| {
                all_monitors
                    .iter()
                    .find(|m| m.position().x == px && m.position().y == py)
            })
        })
        .or_else(|| all_monitors.first());

    let Some(monitor) = target else { return };

    let mon_x = monitor.position().x;
    let mon_y = monitor.position().y;
    let mon_w = monitor.size().width as i32;
    let mon_h = monitor.size().height as i32;

    // Island: top-centred on the target monitor only when the user has no
    // explicit saved position.
    if ui.island_pos.is_none() {
        let island_w = ui.island_width.unwrap_or(400) as i32;
        let ix = mon_x + (mon_w - island_w) / 2;
        let iy = mon_y + 8;
        let _ = macos::set_overlay_position(app, "island", ix, iy);
    }

    // Main window: centred on the target monitor.
    if let Some(main_win) = app.get_webview_window("main") {
        if let Ok(size) = main_win.outer_size() {
            let wx = mon_x + (mon_w - size.width as i32) / 2;
            let wy = mon_y + (mon_h - size.height as i32) / 2;
            let _ = main_win.set_position(tauri::Position::Physical(tauri::PhysicalPosition::new(
                wx, wy,
            )));
        }
    }

    // Karaoke: anchored to the top or bottom edge of the target monitor.
    if let Some(karaoke_win) = app.get_webview_window("karaoke") {
        if let Ok(size) = karaoke_win.outer_size() {
            let offset = ui.karaoke_offset_px as i32;
            let kh = size.height as i32;
            // Fill the monitor's full width.
            let kx = mon_x;
            let ky = if ui.karaoke_position == "top" {
                mon_y + offset
            } else {
                mon_y + mon_h - kh - offset
            };
            let _ = macos::set_overlay_position(app, "karaoke", kx, ky);
        }
    }
}

/// Apply OS-level window flags from `WindowSettings` to the regular `main`
/// window. Called from the `update_settings` command and once at startup so
/// the persisted preferences take effect. Island/karaoke are NSPanels with
/// their own native level/click-through handling and are intentionally
/// unaffected here.
pub(crate) fn apply_main_window_settings(
    app: &tauri::AppHandle,
    window: &lyra_core::domain::WindowSettings,
) {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.set_ignore_cursor_events(window.click_through);
        let _ = main.set_always_on_top(window.always_on_top);
    }
}

/// Track key, state, lyric status, active line, the ignored media shown when
/// idle, and the metadata a player may fill in after a track change
/// (duration, artwork). Paused/stopped ticks are only emitted when this
/// changes, so late metadata must be part of it.
type PollSignature = (
    Option<String>,
    PlaybackState,
    u8,
    Option<usize>,
    Option<String>,
    u64,
    Option<String>,
);

struct PollContext {
    last_signature: std::sync::Mutex<Option<PollSignature>>,
    last_emit_ms: std::sync::Mutex<u64>,
}

impl PollContext {
    fn new() -> Self {
        Self {
            last_signature: std::sync::Mutex::new(None),
            last_emit_ms: std::sync::Mutex::new(0),
        }
    }
}

/// Process a single poll iteration. Pushes the snapshot into the runtime,
/// emits a coalesced `playback-tick` event if needed, and returns the
/// number of milliseconds the caller should wait before the next tick.
///
/// Shared by the macOS dispatch_source-driven loop and the Windows
/// std::thread::sleep-driven loop so the emit/coalesce logic stays
/// identical across platforms.
/// True if at least one of the three lyric surfaces is currently visible.
/// Used as a fast pre-check to skip the player-poll roundtrip entirely when
/// nothing on screen would consume the result.
fn any_surface_visible(handle: &tauri::AppHandle) -> bool {
    let Some(app_state) = handle.try_state::<AppState>() else {
        return true; // fail open — better to poll than to stall
    };
    let (floating_cfg, island_cfg, karaoke_cfg) = app_state.ui.visibility_triple();
    app_state
        .surface_visibility
        .is_visible("island", island_cfg)
        || app_state
            .surface_visibility
            .is_visible("main", floating_cfg)
        || app_state
            .surface_visibility
            .is_visible("karaoke", karaoke_cfg)
}

fn process_tick(
    handle: &tauri::AppHandle,
    ctx: &PollContext,
    snapshot: Option<lyra_core::domain::PlaybackSnapshot>,
) -> u64 {
    let is_fast_tick = snapshot.is_none();
    let mut current_state = snapshot.as_ref().map(|s| s.state.clone());

    let Some(app_state) = handle.try_state::<AppState>() else {
        return 500;
    };

    // visibility_triple is a cheap lock-and-read of 3 bools; the previous
    // snapshot() cloned all 25 UiState fields per tick (4×/sec while playing).
    let (floating_cfg, island_cfg, karaoke_cfg) = app_state.ui.visibility_triple();
    let island_vis = app_state
        .surface_visibility
        .is_visible("island", island_cfg);
    let floating_vis = app_state
        .surface_visibility
        .is_visible("main", floating_cfg);
    let karaoke_vis = app_state
        .surface_visibility
        .is_visible("karaoke", karaoke_cfg);
    let any_visible = island_vis || floating_vis || karaoke_vis;

    let (render_opt, base_interval_ms, next_transition_playback) = {
        let mut rt = match app_state.runtime.lock() {
            Ok(g) => g,
            Err(poisoned) => poisoned.into_inner(),
        };
        if let Some(snap) = snapshot {
            rt.set_playback_snapshot(snap);
        }
        // Base cadence from core: the saved interval (bounded) or the
        // battery-saver interval.
        let base = rt.settings().behavior.effective_poll_interval_ms();
        let render = rt.tick();
        let current_pos = render.playback.position_ms.unwrap_or(0);
        let next_t = rt.next_transition_playback_ms(current_pos);
        (Some(render), base, next_t)
    };

    let mut lyrics_ready = false;

    if let (Some(render), Some(refs)) = (
        render_opt.as_ref(),
        handle.try_state::<tray::TrayMenuRefs>(),
    ) {
        refs.sync_now_playing(render);
    }

    if let Some(render) = render_opt.as_ref() {
        lyrics_ready = matches!(render.lyrics_status, lyra_core::domain::LyricsStatus::Ready);
        current_state = Some(render.playback.state.clone());

        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);

        // Coalesce redundant emits when paused/stopped: nothing
        // observable changes from the frontend's POV until URI, state,
        // lyrics status, or active line shifts. Heartbeat every 10s
        // anyway so a re-subscribed window converges quickly.
        let track = render.playback.track.as_ref();
        let signature: PollSignature = (
            track.map(|t| t.uri.clone()),
            render.playback.state.clone(),
            lyrics_status_disc(&render.lyrics_status),
            render.active_line_index,
            render
                .playback
                .ignored
                .as_ref()
                .map(|i| format!("{}:{:?}", i.track_key, i.reason)),
            track.map(|t| t.duration_ms).unwrap_or(0),
            track.and_then(|t| t.artwork_url.clone()),
        );
        let changed =
            ctx.last_signature.lock().ok().and_then(|g| g.clone()) != Some(signature.clone());
        let heartbeat = {
            let last = ctx
                .last_emit_ms
                .lock()
                .map(|g| *g)
                .unwrap_or_else(|e| *e.into_inner());
            now_ms.saturating_sub(last) > 10_000
        };
        let should_emit = any_visible
            && if is_fast_tick {
                changed
            } else {
                match render.playback.state {
                    PlaybackState::Playing => true,
                    _ => changed || heartbeat,
                }
            };

        if should_emit {
            // Serialize the payload once via emit_filter and route only to
            // visible windows. The previous per-window loop cloned + JSON-
            // serialized the snapshot once per target.
            let send_main = floating_vis;
            let send_island = island_vis;
            let send_karaoke = karaoke_vis;
            let _ = handle.emit_filter("playback-tick", &render, |target| match target {
                EventTarget::WebviewWindow { label } => match label.as_str() {
                    "main" => send_main,
                    "island" => send_island,
                    "karaoke" => send_karaoke,
                    _ => false,
                },
                _ => false,
            });
            if let Ok(mut g) = ctx.last_emit_ms.lock() {
                *g = now_ms;
            }
            if let Ok(mut g) = ctx.last_signature.lock() {
                *g = Some(signature);
            }
        } else if changed {
            if let Ok(mut g) = ctx.last_signature.lock() {
                *g = Some(signature);
            }
        }
    }

    // Cadence is anchored to the configured base interval
    // (`base_interval_ms`, already clamped). When lyrics are ready we poll at
    // that base for tight line sync; other states back off relative to it
    // since nothing on screen is animating, but never poll *faster* than the
    // user asked for.
    let base_sleep = match (any_visible, current_state.as_ref(), lyrics_ready) {
        (false, _, _) => 10_000,
        (true, Some(PlaybackState::Playing), true) => base_interval_ms,
        (true, Some(PlaybackState::Playing), false) => base_interval_ms.max(1_000),
        (true, Some(PlaybackState::Paused), _) => base_interval_ms.max(1_500),
        (true, Some(PlaybackState::Stopped), _) | (true, None, _) => base_interval_ms.max(2_500),
    };

    let mut sleep_ms = base_sleep;
    if any_visible && current_state == Some(PlaybackState::Playing) && lyrics_ready {
        if let Some(render) = &render_opt {
            let rate = render.playback.rate;
            if let (Some(trans_pos), true) = (next_transition_playback, rate > 0.0) {
                let current_pos = render.playback.position_ms.unwrap_or(0);
                if trans_pos > current_pos {
                    // Playback-time distance to wall-clock delay.
                    let time_to_trans = ((trans_pos - current_pos) as f64 / rate).ceil() as u64;
                    if time_to_trans < base_sleep {
                        sleep_ms = time_to_trans.max(10);
                    }
                }
            }
        }
    }
    if any_visible && app_state.players.is_settling() {
        sleep_ms = sleep_ms.min(SETTLE_REPOLL_MS);
    }
    sleep_ms
}

/// macOS poll loop using a GCD `dispatch_source_t` timer with leeway.
///
/// Replacing `std::thread::sleep` with a leeway-aware timer is the single
/// most impactful change on macOS energy: the kernel is free to align our
/// wake-ups with other system timers (network keep-alives, screen
/// refreshes, other apps' timers) within the leeway window, instead of
/// firing on a strict deadline. Activity Monitor's energy score heavily
/// weights raw wake-ups per second.
///
/// Leeway is 25% of the next delay (min 50ms), which Apple's power-
/// efficiency guidelines suggest as a sensible default for "I want this
/// roughly now, but not urgently."
#[cfg(target_os = "macos")]
fn start_macos_poll_loop<F>(handle: tauri::AppHandle, poll_fn: F)
where
    F: FnMut() -> Option<lyra_core::domain::PlaybackSnapshot> + Send + 'static,
{
    use dispatch2::{DispatchObject, DispatchQueue, DispatchSource, DispatchTime};
    use std::ffi::c_void;

    struct State {
        handle: tauri::AppHandle,
        poll_fn: std::sync::Mutex<
            Box<dyn FnMut() -> Option<lyra_core::domain::PlaybackSnapshot> + Send>,
        >,
        ctx: PollContext,
        timer: std::sync::Mutex<Option<dispatch2::DispatchRetained<DispatchSource>>>,
        last_player_poll_ms: std::sync::Mutex<u64>,
        /// Set by `PollTrigger`; forces the next fire to poll the adapters.
        force_poll: std::sync::atomic::AtomicBool,
    }

    extern "C" fn handler(raw_ctx: *mut c_void) {
        if raw_ctx.is_null() {
            return;
        }
        // SAFETY: `raw_ctx` was set via `dispatch_set_context` to the
        // pointer of a `Box::leak`'d `State`. The Box is never freed —
        // the polling driver runs for the process lifetime.
        let state: &State = unsafe { &*(raw_ctx as *const State) };

        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);

        let poll_interval_ms = {
            if let Some(app_state) = state.handle.try_state::<AppState>() {
                let rt = app_state.runtime.lock().unwrap_or_else(|e| e.into_inner());
                rt.settings().behavior.effective_poll_interval_ms()
            } else {
                300
            }
        };

        let last_poll = *state
            .last_player_poll_ms
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let elapsed = now_ms.saturating_sub(last_poll);
        let forced = state
            .force_poll
            .swap(false, std::sync::atomic::Ordering::AcqRel);
        let poll_due = forced || player_poll_due(&state.handle, elapsed, poll_interval_ms);

        // Forced polls answer a user action (transport control, surface
        // shown), so they get the same latency treatment as line transitions.
        if poll_due && !forced {
            set_thread_qos_utility();
        } else {
            set_thread_qos_user_initiated();
        }

        // Skip the player poll entirely when no surface is visible — the
        // resulting snapshot would just be coalesced away inside process_tick
        // anyway. Saves a per-10s AppleScript fire while everything is hidden.
        // Early lyric-transition wakeups also skip it.
        let snapshot = if any_surface_visible(&state.handle) && poll_due {
            if let Ok(mut g) = state.last_player_poll_ms.lock() {
                *g = now_ms;
            }
            (state.poll_fn.lock().unwrap_or_else(|e| e.into_inner()))()
        } else {
            None
        };
        let mut next_ms = process_tick(&state.handle, &state.ctx, snapshot);
        // A poll request that landed while this handler ran must not be
        // overwritten by the re-arm below.
        if state.force_poll.load(std::sync::atomic::Ordering::Acquire) {
            next_ms = 0;
        }

        // Re-arm the one-shot timer for the next fire.
        // For transitions (next_ms < poll_interval_ms), we use zero leeway for precise wakeups.
        if let Some(timer) = state
            .timer
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()
        {
            let is_transition = next_ms < poll_interval_ms;
            let leeway_ns: u64 = if is_transition {
                0
            } else {
                (next_ms.saturating_mul(250_000)).max(50_000_000)
            };
            let when = DispatchTime::NOW.time((next_ms as i64) * 1_000_000);
            timer.set_timer(when, u64::MAX, leeway_ns);
        }
    }

    let queue = DispatchQueue::new("app.lyralyrics.desktop.player-poll", None);
    let timer_type_ptr: *mut dispatch2::dispatch_source_type_s =
        unsafe { &dispatch2::_dispatch_source_type_timer as *const _ as *mut _ };
    let timer = unsafe { DispatchSource::new(timer_type_ptr, 0, 0, Some(&queue)) };

    let state = Box::leak(Box::new(State {
        handle,
        poll_fn: std::sync::Mutex::new(Box::new(poll_fn)),
        ctx: PollContext::new(),
        timer: std::sync::Mutex::new(Some(timer.retain())),
        last_player_poll_ms: std::sync::Mutex::new(0),
        force_poll: std::sync::atomic::AtomicBool::new(false),
    }));
    let state: &'static State = state;

    timer.set_event_handler_f(handler);
    // SAFETY: `state` is a `'static` pointer to a leaked `State`. The
    // dispatch object holds the context for the lifetime of the source,
    // which is itself stored inside `State` — both live forever.
    unsafe {
        timer.set_context(state as *const State as *mut c_void);
    }

    if let Some(app_state) = state.handle.try_state::<AppState>() {
        app_state.poll.install(move || {
            state
                .force_poll
                .store(true, std::sync::atomic::Ordering::Release);
            // dispatch_source_set_timer is thread-safe; fire as soon as the
            // queue is free.
            if let Some(timer) = state
                .timer
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .as_ref()
            {
                timer.set_timer(DispatchTime::NOW, u64::MAX, 0);
            }
        });
    }

    // Schedule the first fire immediately, then the handler self-reschedules.
    timer.set_timer(DispatchTime::NOW, u64::MAX, 0);
    timer.resume();
    // `timer` (DispatchRetained) is dropped here; the retain held inside
    // `state.timer` keeps the underlying GCD source alive.
}

/// Generic fallback poll loop (Windows / non-macOS). Uses plain
/// `std::thread::sleep` — no GCD on these platforms.
#[cfg(not(target_os = "macos"))]
fn poll_loop_generic<F>(handle: tauri::AppHandle, mut poll_fn: F)
where
    F: FnMut() -> Option<lyra_core::domain::PlaybackSnapshot> + Send + 'static,
{
    let ctx = PollContext::new();
    let mut last_player_poll_ms = 0u64;
    let wake = std::sync::Arc::new((Mutex::new(false), std::sync::Condvar::new()));
    if let Some(app_state) = handle.try_state::<AppState>() {
        let wake = wake.clone();
        app_state.poll.install(move || {
            let (flag, cvar) = &*wake;
            if let Ok(mut requested) = flag.lock() {
                *requested = true;
                cvar.notify_one();
            }
        });
    }
    let mut forced = false;
    loop {
        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);

        let poll_interval_ms = {
            if let Some(app_state) = handle.try_state::<AppState>() {
                let rt = app_state.runtime.lock().unwrap_or_else(|e| e.into_inner());
                rt.settings().behavior.effective_poll_interval_ms()
            } else {
                300
            }
        };

        let elapsed = now_ms.saturating_sub(last_player_poll_ms);

        let snapshot = if any_surface_visible(&handle)
            && (forced || player_poll_due(&handle, elapsed, poll_interval_ms))
        {
            last_player_poll_ms = now_ms;
            poll_fn()
        } else {
            None
        };

        let next_ms = process_tick(&handle, &ctx, snapshot);
        // Sleep until the next tick or an explicit poll request.
        let (flag, cvar) = &*wake;
        let mut requested = flag.lock().unwrap_or_else(|e| e.into_inner());
        if !*requested {
            requested = cvar
                .wait_timeout(requested, std::time::Duration::from_millis(next_ms))
                .map(|(guard, _)| guard)
                .unwrap_or_else(|e| e.into_inner().0);
        }
        forced = std::mem::take(&mut *requested);
    }
}

fn lyrics_status_disc(s: &lyra_core::domain::LyricsStatus) -> u8 {
    use lyra_core::domain::LyricsStatus::*;
    match s {
        Loading => 0,
        Ready => 1,
        Unsynced => 4,
        NotFound { .. } => 2,
        Error(_) => 3,
    }
}

/// Lower the calling thread to the "utility" Quality of Service class on
/// macOS. The scheduler then runs the work on Apple-Silicon E-cores
/// (efficiency cores) instead of P-cores wherever possible. E-cores draw a
/// fraction of the power of P-cores, so background polling that ends up on
/// E-cores barely shows up in Activity Monitor's energy column.
#[cfg(target_os = "macos")]
fn set_thread_qos_utility() {
    set_thread_qos(libc::qos_class_t::QOS_CLASS_UTILITY);
}

/// Raise the calling thread for on-screen lyric transition ticks on macOS.
/// These ticks do not run AppleScript; they only compute and emit an already
/// scheduled line change. Keeping them out of Utility QoS avoids visible
/// transition latency when macOS Low Power Mode throttles utility work.
#[cfg(target_os = "macos")]
fn set_thread_qos_user_initiated() {
    set_thread_qos(libc::qos_class_t::QOS_CLASS_USER_INITIATED);
}

#[cfg(target_os = "macos")]
fn set_thread_qos(qos: libc::qos_class_t) {
    // SAFETY: `pthread_set_qos_class_self_np` only mutates the calling
    // thread's scheduling class. Both arguments are POD; second is a
    // relative-priority hint (0 = default within the class).
    unsafe {
        let _ = libc::pthread_set_qos_class_self_np(qos, 0);
    }
}

#[cfg(not(target_os = "macos"))]
fn set_thread_qos_utility() {}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(target_os = "macos")]
    let builder = builder.menu(menu::build).on_menu_event(menu::handle_event);
    builder
        .register_uri_scheme_protocol(ARTWORK_SCHEME, |ctx, request| {
            artwork_response(ctx.app_handle(), &request)
        })
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            app.handle()
                .plugin(tauri_plugin_clipboard_manager::init())?;

            // Register the autostart plugin for all builds (macOS LaunchAgent /
            // Windows registry). This must be registered before any command that
            // calls `app.autolaunch()`.
            app.handle().plugin(tauri_plugin_autostart::init(
                tauri_plugin_autostart::MacosLauncher::LaunchAgent,
                Some(vec![]),
            ))?;

            migrate_app_support_dir();
            let dir = app_support_dir();
            let ui = UiStateStore::load(&dir);
            let initial = ui.snapshot();
            // Until the first-run explanation is acknowledged, don't script
            // Spotify or Music: that is what triggers macOS's permission prompt.
            #[cfg(target_os = "macos")]
            lyra_core::player::set_automation_enabled(initial.onboarded);

            let runtime = LyraRuntime::new_in(dir.clone());
            let players = Arc::new(
                PlayerHub::new(platform_adapters(), artwork_base_url())
                    .with_media_policy(&dir)
                    .with_known_players(&dir)
                    .with_lyric_cache(runtime.cache.clone()),
            );
            players.set_lookups_allowed(
                runtime.settings().behavior.browser_lyrics == BrowserLyrics::Allow,
            );
            app.manage(AppState {
                runtime: Mutex::new(runtime),
                lyrics: LyricsRefresh::default(),
                players: Arc::clone(&players),
                ui,
                surface_visibility: RuntimeSurfaceVisibility::new_all_hidden(),
                poll: PollTrigger::default(),
            });

            #[cfg(target_os = "macos")]
            {
                // Register the nspanel plugin so get_webview_panel() works.
                app.handle().plugin(tauri_nspanel::init())?;
            }

            // Convert overlay windows to NSPanel so they can float above other
            // apps. Battery saver keeps the island off the glass.
            let battery_saver = app
                .state::<AppState>()
                .runtime
                .lock()
                .map(|rt| rt.settings().behavior.battery_saver)
                .unwrap_or(false);
            let _ = macos::init_overlay_panels(app.handle(), !battery_saver);

            // Build the system tray menu.
            tray::create_tray(app.handle(), &initial)?;

            // Background update checks (release builds with a signing key).
            updater::init(app.handle())?;

            // Windows start hidden (tauri.conf.json visible:false). Each
            // surface's frontend calls `window_ready` once its WebView has
            // mounted, at which point the backend applies the persisted
            // visibility. This prevents the empty-window flash that occurs
            // when the native frame becomes visible before React renders.

            // Restore persisted island size (before position so the frame is correct).
            if let (Some(w), Some(h)) = (initial.island_width, initial.island_height) {
                let _ = macos::set_island_size(app.handle(), w, h);
            }

            // Restore persisted island position immediately at startup so the window
            // appears in the right place before the frontend finishes loading.
            // The frontend will also run its own positioning logic and may override this
            // for the default-center case (when no position is saved).
            if let Some((x, y)) = initial.island_pos {
                let _ = macos::set_overlay_position(app.handle(), "island", x, y);
            }

            // Position all surfaces on the preferred monitor (or primary as fallback).
            // This handles the default island position when island_pos is None.
            apply_preferred_monitor_positioning(app.handle(), &initial);

            // Sync the OS-level autostart state with the persisted preference.
            // If the user previously enabled autostart but the LaunchAgent was
            // removed externally, this re-applies their intent.
            {
                use tauri_plugin_autostart::ManagerExt;
                let plugin_enabled = app.handle().autolaunch().is_enabled().unwrap_or(false);
                if initial.autostart_enabled != plugin_enabled {
                    if initial.autostart_enabled {
                        let _ = app.handle().autolaunch().enable();
                    } else {
                        let _ = app.handle().autolaunch().disable();
                    }
                }
            }

            // Click-through for karaoke (always) and the island (when the user
            // turned it on) is applied in `window_ready`, once each window is
            // realized.

            // Apply persisted main-window flags (click-through / always-on-top).
            {
                let window_settings = app
                    .state::<AppState>()
                    .runtime
                    .lock()
                    .map(|rt| rt.settings().window.clone())
                    .unwrap_or_default();
                apply_main_window_settings(app.handle(), &window_settings);
            }

            #[cfg(target_os = "macos")]
            {
                use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial};
                // Settings sits on the sidebar material (what System Settings
                // uses; it follows light/dark, unlike the always-dark HUD
                // material). The page itself is near-opaque on top, so only a
                // hint of the desktop shows through.
                if let Some(settings_win) = app.get_webview_window("settings") {
                    let _ =
                        apply_vibrancy(&settings_win, NSVisualEffectMaterial::Sidebar, None, None);
                }

                // GCD-driven poll loop with leeway timer. Runs on its own
                // queue thread; full player polls use QoS_UTILITY, while
                // transition-only lyric ticks temporarily use a higher QoS.
                let handle = app.handle().clone();
                let probe_handle = app.handle().clone();
                let players = Arc::clone(&players);
                start_macos_poll_loop(handle, move || Some(poll_players(&probe_handle, &players)));
            }

            #[cfg(target_os = "windows")]
            {
                // Remove native title bars so they blend with the app background.
                if let Some(main_win) = app.get_webview_window("main") {
                    let _ = main_win.set_decorations(false);
                }
                if let Some(settings_win) = app.get_webview_window("settings") {
                    let _ = settings_win.set_decorations(false);
                }

                // Windows: poll players via SMTC (System Media Transport Controls).
                let handle = app.handle().clone();
                let probe_handle = app.handle().clone();
                let players = Arc::clone(&players);
                std::thread::spawn(move || {
                    set_thread_qos_utility();
                    poll_loop_generic(handle, move || Some(poll_players(&probe_handle, &players)));
                });
            }

            #[cfg(target_os = "linux")]
            {
                // Linux: poll players through MPRIS on the user's D-Bus
                // session bus. MPRIS is distro-independent.
                let handle = app.handle().clone();
                let probe_handle = app.handle().clone();
                let players = Arc::clone(&players);
                std::thread::spawn(move || {
                    set_thread_qos_utility();
                    poll_loop_generic(handle, move || Some(poll_players(&probe_handle, &players)));
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_ui_state,
            commands::toggle_surface,
            commands::set_show_on_fullscreen,
            commands::set_island_locked,
            commands::set_island_click_through,
            commands::open_main_window,
            commands::island_pointer_inside,
            commands::complete_onboarding,
            commands::copy_text,
            commands::get_automation_denied,
            commands::open_automation_settings,
            commands::set_font_scale,
            commands::set_theme,
            commands::update_karaoke_settings,
            commands::update_island_settings,
            commands::set_overlay_position,
            commands::save_island_position,
            commands::set_island_size,
            commands::get_render_snapshot,
            commands::get_all_lyrics,
            commands::get_all_lines,
            commands::get_plain_lyrics,
            commands::get_settings,
            commands::get_lyric_offset,
            commands::set_lyric_offset,
            commands::nudge_lyric_offset,
            commands::update_settings,
            commands::refresh_lyrics,
            commands::force_refresh_lyrics,
            commands::clear_lyrics_cache,
            commands::playback_play_pause,
            commands::playback_next,
            commands::playback_previous,
            commands::playback_seek_ms,
            commands::playback_raise,
            commands::get_player_sessions,
            commands::set_browser_lyrics,
            commands::get_media_policy,
            commands::set_pinned_app,
            commands::get_known_players,
            commands::forget_player,
            commands::set_only_music,
            commands::set_app_rule,
            commands::set_track_override,
            commands::get_available_monitors,
            commands::set_preferred_monitor,
            commands::get_autostart_status,
            commands::set_autostart,
            commands::window_ready,
            commands::set_surface_occluded,
            updater::get_update_status,
            updater::check_for_updates,
            updater::install_update,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let label = window.label();
                if label == "main" || label == "island" || label == "karaoke" {
                    api.prevent_close();
                    let app = window.app_handle();
                    let currently_visible = {
                        let state = app.state::<AppState>();
                        let ui = state.ui.snapshot();
                        match label {
                            "main" => ui.floating_visible,
                            "island" => ui.island_visible,
                            "karaoke" => ui.karaoke_visible,
                            _ => false,
                        }
                    };
                    if currently_visible {
                        crate::tray::toggle_surface(app, label);
                    } else {
                        let _ = window.hide();
                    }
                } else if label == "settings" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error building Lyra")
        .run(|app, event| match event {
            tauri::RunEvent::Exit => {
                // Stop player helper processes (macOS MediaRemote stream).
                if let Some(state) = app.try_state::<AppState>() {
                    state.players.shutdown();
                }
            }
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen { .. } => crate::tray::open_lyra(app),
            _ => {}
        });
}

#[cfg(test)]
mod tests {
    use super::RuntimeSurfaceVisibility;

    #[test]
    fn runtime_surfaces_start_hidden_until_marked_visible() {
        let visibility = RuntimeSurfaceVisibility::new_all_hidden();
        visibility.set_ready("main");

        assert!(!visibility.is_visible("main", true));
        visibility.set_visible("main", true);
        assert!(visibility.is_visible("main", true));
        visibility.set_visible("main", false);
        assert!(!visibility.is_visible("main", true));
    }

    #[test]
    fn occluded_surface_is_not_visible_until_revealed() {
        let visibility = RuntimeSurfaceVisibility::new_all_hidden();
        visibility.set_ready("main");
        visibility.set_visible("main", true);

        visibility.set_occluded("main", true);
        assert!(!visibility.is_visible("main", true));
        visibility.set_occluded("main", false);
        assert!(visibility.is_visible("main", true));
    }

    #[test]
    fn persisted_hidden_surface_stays_hidden_even_if_runtime_visible() {
        let visibility = RuntimeSurfaceVisibility::new_all_hidden();
        visibility.set_ready("island");

        visibility.set_visible("island", true);

        assert!(!visibility.is_visible("island", false));
    }
}
