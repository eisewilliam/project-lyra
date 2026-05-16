mod commands;
mod macos;
mod runtime;
mod tray;
mod ui_state;

use lyra_core::domain::PlaybackState;
use lyra_core::lyrics::lrclib::LrclibClient;
use runtime::LyraRuntime;
use std::collections::HashSet;
use std::sync::Mutex;
use tauri::{Emitter, Manager};
use ui_state::UiStateStore;

pub struct AppState {
    pub runtime: Mutex<LyraRuntime>,
    /// Shared HTTP client — lives outside the Mutex so commands can
    /// release `runtime` before awaiting network calls.
    pub lrclib: LrclibClient,
    pub ui: UiStateStore,
    /// URIs currently being fetched — prevents concurrent duplicate requests.
    pub fetch_in_flight: Mutex<HashSet<String>>,
}

fn app_support_dir() -> std::path::PathBuf {
    dirs_next::data_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("lyra")
}

type PollSignature = (Option<String>, PlaybackState, u8, Option<usize>);

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
fn process_tick(
    handle: &tauri::AppHandle,
    ctx: &PollContext,
    snapshot: Option<lyra_core::domain::PlaybackSnapshot>,
) -> u64 {
    let current_state = snapshot.as_ref().map(|s| s.state.clone());

    let any_window_visible = handle
        .try_state::<AppState>()
        .map(|s| {
            let ui = s.ui.snapshot();
            ui.island_visible || ui.floating_visible || ui.karaoke_visible
        })
        .unwrap_or(true);

    if let Some(app_state) = handle.try_state::<AppState>() {
        let render_opt = {
            let mut rt = match app_state.runtime.lock() {
                Ok(g) => g,
                Err(_) => return 500,
            };
            if let Some(snap) = snapshot {
                rt.set_playback_snapshot(snap);
            }
            Some(rt.tick())
        };

        if let Some(render) = render_opt {
            let now_ms = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);

            // Coalesce redundant emits when paused/stopped: nothing
            // observable changes from the frontend's POV until URI, state,
            // lyrics status, or active line shifts. Heartbeat every 10s
            // anyway so a re-subscribed window converges quickly.
            let signature: PollSignature = (
                render.playback.track.as_ref().map(|t| t.uri.clone()),
                render.playback.state.clone(),
                lyrics_status_disc(&render.lyrics_status),
                render.active_line_index,
            );
            let changed = ctx.last_signature.lock().ok().and_then(|g| g.clone()) != Some(signature.clone());
            let heartbeat = {
                let last = *ctx.last_emit_ms.lock().unwrap();
                now_ms.saturating_sub(last) > 10_000
            };
            let should_emit = any_window_visible
                && match render.playback.state {
                    PlaybackState::Playing => true,
                    _ => changed || heartbeat,
                };

            if should_emit {
                let _ = handle.emit("playback-tick", render);
                *ctx.last_emit_ms.lock().unwrap() = now_ms;
                *ctx.last_signature.lock().unwrap() = Some(signature);
            } else if changed {
                *ctx.last_signature.lock().unwrap() = Some(signature);
            }
        }
    }

    match (any_window_visible, current_state) {
        (false, _) => 10_000,
        (true, Some(PlaybackState::Playing)) => 250,
        (true, Some(PlaybackState::Paused)) => 1500,
        (true, Some(PlaybackState::Stopped)) | (true, None) => 2500,
    }
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
        poll_fn: std::sync::Mutex<Box<dyn FnMut() -> Option<lyra_core::domain::PlaybackSnapshot> + Send>>,
        ctx: PollContext,
        timer: std::sync::Mutex<Option<dispatch2::DispatchRetained<DispatchSource>>>,
    }

    extern "C" fn handler(raw_ctx: *mut c_void) {
        if raw_ctx.is_null() {
            return;
        }
        // SAFETY: `raw_ctx` was set via `dispatch_set_context` to the
        // pointer of a `Box::leak`'d `State`. The Box is never freed —
        // the polling driver runs for the process lifetime.
        let state: &State = unsafe { &*(raw_ctx as *const State) };

        set_thread_qos_utility();

        let snapshot = (state.poll_fn.lock().unwrap())();
        let next_ms = process_tick(&state.handle, &state.ctx, snapshot);

        // Re-arm the one-shot timer for the next fire. Leeway = 25% of
        // delay, floored at 50ms — kernel can coalesce with other wakes.
        if let Some(timer) = state.timer.lock().unwrap().as_ref() {
            let leeway_ns: u64 = (next_ms.saturating_mul(250_000)).max(50_000_000);
            let when = DispatchTime::NOW.time((next_ms as i64) * 1_000_000);
            timer.set_timer(when, u64::MAX, leeway_ns);
        }
    }

    let queue = DispatchQueue::new("com.lyra.spotify.poll", None);
    let timer_type_ptr: *mut dispatch2::dispatch_source_type_s =
        unsafe { &dispatch2::_dispatch_source_type_timer as *const _ as *mut _ };
    let timer = unsafe { DispatchSource::new(timer_type_ptr, 0, 0, Some(&queue)) };

    let state = Box::leak(Box::new(State {
        handle,
        poll_fn: std::sync::Mutex::new(Box::new(poll_fn)),
        ctx: PollContext::new(),
        timer: std::sync::Mutex::new(Some(timer.retain())),
    }));

    timer.set_event_handler_f(handler);
    // SAFETY: `state` is a `'static` pointer to a leaked `State`. The
    // dispatch object holds the context for the lifetime of the source,
    // which is itself stored inside `State` — both live forever.
    unsafe {
        timer.set_context(state as *mut State as *mut c_void);
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
    loop {
        let snapshot = poll_fn();
        let next_ms = process_tick(&handle, &ctx, snapshot);
        std::thread::sleep(std::time::Duration::from_millis(next_ms));
    }
}

fn lyrics_status_disc(s: &lyra_core::domain::LyricsStatus) -> u8 {
    use lyra_core::domain::LyricsStatus::*;
    match s {
        Loading => 0,
        Ready => 1,
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
    // SAFETY: `pthread_set_qos_class_self_np` only mutates the calling
    // thread's scheduling class. Both arguments are POD; second is a
    // relative-priority hint (0 = default within the class).
    unsafe {
        let _ = libc::pthread_set_qos_class_self_np(libc::qos_class_t::QOS_CLASS_UTILITY, 0);
    }
}

#[cfg(not(target_os = "macos"))]
fn set_thread_qos_utility() {}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            let dir = app_support_dir();
            let ui = UiStateStore::load(&dir);
            let initial = ui.snapshot();

            app.manage(AppState {
                runtime: Mutex::new(LyraRuntime::new()),
                lrclib: LrclibClient::new(),
                ui,
                fetch_in_flight: Mutex::new(HashSet::new()),
            });

            #[cfg(target_os = "macos")]
            {
                // Register the nspanel plugin so get_webview_panel() works.
                app.handle().plugin(tauri_nspanel::init())?;
            }

            // Convert overlay windows to NSPanel so they can float above other apps.
            let _ = macos::init_overlay_panels(app.handle());

            // Build the system tray menu.
            tray::create_tray(app.handle(), &initial)?;

            // Apply initial visibility for every surface.
            for label in &["main", "island", "karaoke"] {
                tray::apply_window_visibility(app.handle(), label, &initial);
            }

            // Restore persisted island size (before position so the frame is correct).
            if let (Some(w), Some(h)) = (initial.island_width, initial.island_height) {
                let _ = macos::set_island_size(app.handle(), w, h);
            }

            #[cfg(target_os = "macos")]
            {
                // GCD-driven poll loop with leeway timer. Runs on its own
                // queue thread; QoS_UTILITY set inside each handler fire.
                let handle = app.handle().clone();
                use lyra_core::player::PlayerAdapter;
                let adapter = lyra_core::player::spotify_macos::SpotifyMacOsAdapter::new();
                start_macos_poll_loop(handle, move || {
                    let _ = adapter.poll();
                    adapter.snapshot()
                });
            }

            #[cfg(target_os = "windows")]
            {
                // Windows: poll Spotify via SMTC (System Media Transport Controls).
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    set_thread_qos_utility();
                    use lyra_core::player::PlayerAdapter;
                    let adapter =
                        lyra_core::player::spotify_windows::SpotifyWindowsAdapter::new();
                    poll_loop_generic(handle, move || {
                        let _ = adapter.poll();
                        adapter.snapshot()
                    });
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_ui_state,
            commands::toggle_surface,
            commands::set_show_on_fullscreen,
            commands::set_island_locked,
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
            commands::get_settings,
            commands::set_click_through,
            commands::update_settings,
            commands::refresh_lyrics,
            commands::force_refresh_lyrics,
            commands::playback_play_pause,
            commands::playback_next,
            commands::playback_previous,
            commands::playback_seek_ms,
        ])
        .run(tauri::generate_context!())
        .expect("error running Lyra");
}
