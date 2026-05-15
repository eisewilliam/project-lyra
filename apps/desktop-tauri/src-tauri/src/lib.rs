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

/// Shared polling driver for every platform adapter.
///
/// On each iteration:
///   1. Run `poll_once` (platform-specific — talks to Spotify / SMTC).
///   2. Push the playback snapshot into `LyraRuntime`.
///   3. Compute a `RenderSnapshot` via `tick()` and emit `playback-tick`
///      to every webview — the frontends listen for this instead of
///      polling, eliminating ~10 IPC/sec at idle.
///   4. Sleep adaptively: tight cadence while playing (so line/word
///      transitions fire on time), slower when paused (position frozen),
///      slowest when stopped (no signal to track). Saves osascript /
///      SMTC wake-ups when the user isn't actively listening.
fn poll_loop<F>(handle: tauri::AppHandle, mut poll_once: F)
where
    F: FnMut() -> Option<lyra_core::domain::PlaybackSnapshot> + Send + 'static,
{
    let mut last_signature: Option<(Option<String>, PlaybackState, u8, Option<usize>)> = None;
    let mut last_emit_ms: u64 = 0;

    loop {
        let snapshot = poll_once();
        let current_state = snapshot.as_ref().map(|s| s.state.clone());

        let any_window_visible = handle
            .try_state::<AppState>()
            .map(|s| {
                let ui = s.ui.snapshot();
                ui.island_visible || ui.floating_visible || ui.karaoke_visible
            })
            .unwrap_or(true);

        if let Some(app_state) = handle.try_state::<AppState>() {
            let render = {
                let mut rt = match app_state.runtime.lock() {
                    Ok(g) => g,
                    Err(_) => {
                        std::thread::sleep(std::time::Duration::from_millis(500));
                        continue;
                    }
                };
                if let Some(snap) = snapshot {
                    rt.set_playback_snapshot(snap);
                }
                rt.tick()
            };

            let now_ms = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);

            // Coalesce redundant emits when paused/stopped: nothing
            // observable changes from the frontend's POV until URI, state,
            // lyrics status, or active line shifts. Heartbeat every 10s
            // anyway so a re-subscribed window converges quickly.
            let signature = (
                render.playback.track.as_ref().map(|t| t.uri.clone()),
                render.playback.state.clone(),
                lyrics_status_disc(&render.lyrics_status),
                render.active_line_index,
            );
            let changed = last_signature.as_ref() != Some(&signature);
            let heartbeat = now_ms.saturating_sub(last_emit_ms) > 10_000;
            let should_emit = any_window_visible
                && match render.playback.state {
                    PlaybackState::Playing => true,
                    _ => changed || heartbeat,
                };

            if should_emit {
                let _ = handle.emit("playback-tick", render);
                last_signature = Some(signature);
                last_emit_ms = now_ms;
            } else if changed {
                // Track the change even when we suppress the emit so that
                // the next genuine event isn't mis-classified.
                last_signature = Some(signature);
            }
        }

        let sleep_ms = match (any_window_visible, current_state) {
            (false, _) => 10_000,
            (true, Some(PlaybackState::Playing)) => 250,
            (true, Some(PlaybackState::Paused)) => 1500,
            (true, Some(PlaybackState::Stopped)) | (true, None) => 2500,
        };
        std::thread::sleep(std::time::Duration::from_millis(sleep_ms));
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
                // Start the backend adapter polling loop only on macOS.
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    use lyra_core::player::PlayerAdapter;
                    let adapter = lyra_core::player::spotify_macos::SpotifyMacOsAdapter::new();
                    poll_loop(handle, move || {
                        let _ = adapter.poll();
                        adapter.snapshot()
                    });
                });
            }

            #[cfg(target_os = "windows")]
            {
                // Windows: poll Spotify via SMTC (System Media Transport Controls).
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    use lyra_core::player::PlayerAdapter;
                    let adapter =
                        lyra_core::player::spotify_windows::SpotifyWindowsAdapter::new();
                    poll_loop(handle, move || {
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
