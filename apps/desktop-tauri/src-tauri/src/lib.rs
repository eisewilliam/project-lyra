mod commands;
mod macos;
mod runtime;
mod tray;
mod ui_state;

use lyra_core::lyrics::lrclib::LrclibClient;
use runtime::LyraRuntime;
use std::collections::HashSet;
use std::sync::Mutex;
use tauri::Manager;
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
                    loop {
                        let _ = adapter.poll();
                        if let Some(snapshot) = adapter.snapshot() {
                            if let Some(state) = handle.try_state::<AppState>() {
                                if let Ok(mut rt) = state.runtime.lock() {
                                    rt.set_playback_snapshot(snapshot);
                                }
                            }
                        }
                        std::thread::sleep(std::time::Duration::from_millis(250));
                    }
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
            commands::set_overlay_position,
            commands::save_island_position,
            commands::set_island_size,
            commands::get_render_snapshot,
            commands::get_all_lyrics,
            commands::get_all_lines,
            commands::get_settings,
            commands::set_click_through,
            commands::refresh_lyrics,
            commands::playback_play_pause,
            commands::playback_next,
            commands::playback_previous,
            commands::playback_seek_ms,
        ])
        .run(tauri::generate_context!())
        .expect("error running Lyra");
}
