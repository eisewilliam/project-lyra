mod commands;
mod runtime;

use lyra_core::lyrics::lrclib::LrclibClient;
use runtime::LyraRuntime;
use std::sync::Mutex;
use tauri::Manager;

pub struct AppState {
    pub runtime: Mutex<LyraRuntime>,
    /// Shared HTTP client — lives outside the Mutex so commands can
    /// release `runtime` before awaiting network calls.
    pub lrclib: LrclibClient,
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

            app.manage(AppState {
                runtime: Mutex::new(LyraRuntime::new()),
                lrclib: LrclibClient::new(),
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_render_snapshot,
            commands::get_settings,
            commands::set_click_through,
            commands::refresh_lyrics,
        ])
        .run(tauri::generate_context!())
        .expect("error running Lyra");
}
