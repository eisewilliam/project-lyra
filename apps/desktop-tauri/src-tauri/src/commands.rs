use crate::tray;
use crate::ui_state::UiState;
use crate::AppState;
use lyra_core::{
    domain::{NotFoundReason, RenderSnapshot, SettingsSnapshot},
    lyrics::LyricSource,
};
use serde::{Deserialize, Serialize};
use std::sync::MutexGuard;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::runtime::LyraRuntime;

/// Lock the runtime mutex, recovering the guard if a previous holder panicked.
/// A poisoned lock should degrade gracefully (stale-but-usable state) rather
/// than cascade-panic every command and kill the poll thread.
fn lock_runtime<'a>(state: &'a State<'_, AppState>) -> MutexGuard<'a, LyraRuntime> {
    state.runtime.lock().unwrap_or_else(|e| e.into_inner())
}

// ── UI State ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_ui_state(state: State<'_, AppState>) -> UiState {
    state.ui.snapshot()
}

#[tauri::command]
pub fn toggle_surface(label: String, app: AppHandle) {
    tray::toggle_surface(&app, &label);
}

#[tauri::command]
pub fn set_show_on_fullscreen(
    surface: String,
    value: bool,
    state: State<'_, AppState>,
    app: AppHandle,
) {
    let new_state = state.ui.mutate(|s| match surface.as_str() {
        "main" => s.floating_show_on_fullscreen = value,
        "island" => s.island_show_on_fullscreen = value,
        "karaoke" => s.karaoke_show_on_fullscreen = value,
        _ => {}
    });
    tray::apply_window_visibility(&app, &surface, &new_state);
    let _ = app.emit("ui-settings-changed", new_state);
}

#[tauri::command]
pub fn set_island_locked(locked: bool, state: State<'_, AppState>, app: AppHandle) {
    let new_state = state.ui.mutate(|s| s.island_locked = locked);
    if let Some(island) = app.get_webview_window("island") {
        let _ = island.set_ignore_cursor_events(locked);
    }
    if let Some(refs) = app.try_state::<tray::TrayMenuRefs>() {
        refs.sync(&new_state);
    }
    let _ = app.emit("island-lock-changed", new_state.island_locked);
    let _ = app.emit("ui-settings-changed", new_state);
}

#[tauri::command]
pub fn set_font_scale(surface: String, scale: f32, state: State<'_, AppState>, app: AppHandle) {
    let new_state = state.ui.mutate(|s| match surface.as_str() {
        "main" => s.floating_font_scale = scale,
        "island" => s.island_font_scale = scale,
        "karaoke" => s.karaoke_font_scale = scale,
        _ => {}
    });
    let _ = app.emit("ui-settings-changed", new_state);
}

#[tauri::command]
pub fn set_theme(theme: String, state: State<'_, AppState>, app: AppHandle) {
    let new_state = state.ui.mutate(|s| s.theme = theme);
    let _ = app.emit("ui-settings-changed", new_state);
}

#[derive(Deserialize)]
pub struct KaraokePatch {
    position: Option<String>,
    alignment: Option<String>,
    width_pct: Option<u32>,
    offset_px: Option<u32>,
    lines: Option<u8>,
    bg_opacity: Option<f32>,
    bold: Option<bool>,
}

#[derive(serde::Deserialize)]
pub struct IslandPatch {
    pub show_cover: Option<bool>,
    pub cover_circle: Option<bool>,
    pub cover_spin: Option<bool>,
}

#[tauri::command]
pub fn update_island_settings(patch: IslandPatch, state: State<'_, AppState>, app: AppHandle) {
    let new_state = state.ui.mutate(|s| {
        if let Some(v) = patch.show_cover {
            s.island_show_cover = v;
        }
        if let Some(v) = patch.cover_circle {
            s.island_cover_circle = v;
        }
        if let Some(v) = patch.cover_spin {
            s.island_cover_spin = v;
        }
    });
    let _ = app.emit("ui-settings-changed", new_state);
}

#[tauri::command]
pub fn update_karaoke_settings(patch: KaraokePatch, state: State<'_, AppState>, app: AppHandle) {
    let new_state = state.ui.mutate(|s| {
        if let Some(v) = patch.position {
            s.karaoke_position = v;
        }
        if let Some(v) = patch.alignment {
            s.karaoke_alignment = v;
        }
        if let Some(v) = patch.width_pct {
            s.karaoke_width_pct = v;
        }
        if let Some(v) = patch.offset_px {
            s.karaoke_offset_px = v;
        }
        if let Some(v) = patch.lines {
            s.karaoke_lines = v;
        }
        if let Some(v) = patch.bg_opacity {
            s.karaoke_bg_opacity = v;
        }
        if let Some(v) = patch.bold {
            s.karaoke_bold = v;
        }
    });
    let _ = app.emit("ui-settings-changed", new_state);
}

#[tauri::command]
pub fn set_overlay_position(label: String, x: i32, y: i32, app: AppHandle) {
    let _ = crate::macos::set_overlay_position(&app, &label, x, y);
}

/// Called by the island frontend after each drag — persists position to disk.
/// Pass x = -1 to clear the saved position (reset to default top-center).
#[tauri::command]
pub fn save_island_position(x: i32, y: i32, state: State<'_, AppState>) {
    state.ui.mutate(|s| {
        s.island_pos = if x == -1 { None } else { Some((x, y)) };
    });
}

/// Resize the island window and persist the new dimensions.
#[tauri::command]
pub fn set_island_size(width: u32, height: u32, state: State<'_, AppState>, app: AppHandle) {
    let new_state = state.ui.mutate(|s| {
        s.island_width = Some(width);
        s.island_height = Some(height);
    });
    let _ = crate::macos::set_island_size(&app, width, height);
    let _ = app.emit("ui-settings-changed", new_state);
}

// ── Core Runtime ──────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_render_snapshot(state: State<'_, AppState>) -> RenderSnapshot {
    lock_runtime(&state).tick()
}

#[tauri::command]
pub fn get_all_lyrics(state: State<'_, AppState>) -> Vec<String> {
    lock_runtime(&state).all_lyrics_lines()
}

#[tauri::command]
pub fn get_all_lines(state: State<'_, AppState>) -> Vec<crate::runtime::LyricLineSlim> {
    lock_runtime(&state).all_lines_slim()
}

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> SettingsSnapshot {
    lock_runtime(&state).settings().clone()
}

// ── Lyric timing offset (per track) ─────────────────────────────────────────────

/// Current track's manual lyric offset in milliseconds (positive = lyrics
/// delayed, negative = advanced).
#[tauri::command]
pub fn get_lyric_offset(state: State<'_, AppState>) -> i64 {
    lock_runtime(&state).current_offset()
}

/// Set the absolute lyric offset for the current track, then broadcast a fresh
/// snapshot so every surface re-syncs immediately. Returns the stored offset.
#[tauri::command]
pub fn set_lyric_offset(offset_ms: i64, state: State<'_, AppState>, app: AppHandle) -> i64 {
    let offset = offset_ms.clamp(-30_000, 30_000);
    let render = {
        let mut rt = lock_runtime(&state);
        rt.set_current_offset(offset);
        rt.tick()
    };
    let _ = app.emit("playback-tick", render);
    offset
}

/// Add `delta_ms` to the current track's offset (used by the quick ± buttons).
/// Returns the new offset.
#[tauri::command]
pub fn nudge_lyric_offset(delta_ms: i64, state: State<'_, AppState>, app: AppHandle) -> i64 {
    let new_offset = {
        let mut rt = lock_runtime(&state);
        let next = (rt.current_offset() + delta_ms).clamp(-30_000, 30_000);
        rt.set_current_offset(next);
        next
    };
    let render = lock_runtime(&state).tick();
    let _ = app.emit("playback-tick", render);
    new_offset
}

// ── Playback Control ──────────────────────────────────────────────────────────

#[tauri::command]
pub fn playback_play_pause() {
    #[cfg(target_os = "macos")]
    lyra_core::player::spotify_macos::play_pause();
    #[cfg(target_os = "windows")]
    lyra_core::player::spotify_windows::play_pause();
}

#[tauri::command]
pub fn playback_next() {
    #[cfg(target_os = "macos")]
    lyra_core::player::spotify_macos::next_track();
    #[cfg(target_os = "windows")]
    lyra_core::player::spotify_windows::next_track();
}

#[tauri::command]
pub fn playback_previous() {
    #[cfg(target_os = "macos")]
    lyra_core::player::spotify_macos::previous_track();
    #[cfg(target_os = "windows")]
    lyra_core::player::spotify_windows::previous_track();
}

#[tauri::command]
pub fn playback_seek_ms(position_ms: u64) {
    #[cfg(target_os = "macos")]
    lyra_core::player::spotify_macos::seek_to_seconds(position_ms as f64 / 1000.0);
    #[cfg(target_os = "windows")]
    lyra_core::player::spotify_windows::seek_to_seconds(position_ms as f64 / 1000.0);
}

#[tauri::command]
pub fn clear_lyrics_cache(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let rt = lock_runtime(&state);
    rt.cache.clear().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn refresh_lyrics(state: State<'_, AppState>) -> Result<(), String> {
    // 1. Grab track + cache state without holding the lock across await.
    let (track, is_neg, already_cached) = {
        let rt = state.runtime.lock().map_err(|e| e.to_string())?;
        let track = rt.current_track();
        let (neg, cached) = track
            .as_ref()
            .map(|t| (rt.is_negative(&t.uri), rt.get_cached(&t.uri).is_some()))
            .unwrap_or((false, false));
        (track, neg, cached)
    };

    let Some(track) = track else { return Ok(()) };
    if is_neg || already_cached {
        return Ok(());
    }

    // 2. Claim the URI so concurrent callers skip the fetch.
    {
        let mut in_flight = state.fetch_in_flight.lock().map_err(|e| e.to_string())?;
        if !in_flight.insert(track.uri.clone()) {
            return Ok(());
        }
    }

    // 3. Network call — no lock held.
    let result = state.lrclib.fetch(&track).await;

    // 4. Release in-flight claim.
    if let Ok(mut in_flight) = state.fetch_in_flight.lock() {
        in_flight.remove(&track.uri);
    }

    // 5. Re-lock to persist result.
    //
    // A confirmed miss (`Ok(None)`) writes a `.nomatch` sentinel so we don't
    // re-query forever. A network/transport error is recorded in-memory only
    // — poisoning the cache for transient failures was the worst behaviour
    // in the old code. Status flips to `NotFound { NetworkError }` until the
    // user hits Retry or restarts the app.
    let mut rt = state.runtime.lock().map_err(|e| e.to_string())?;
    match result {
        Ok(Some(doc)) => rt.store_lyrics(doc),
        Ok(None) => rt.store_negative(&track.uri),
        Err(_) => rt.store_transient_error(&track.uri, NotFoundReason::NetworkError),
    }
    Ok(())
}

/// Force a re-fetch for the currently playing track, ignoring any negative
/// or transient cache entries. Used by the UI Retry button.
#[tauri::command]
pub async fn force_refresh_lyrics(state: State<'_, AppState>) -> Result<(), String> {
    let uri = {
        let rt = state.runtime.lock().map_err(|e| e.to_string())?;
        rt.current_track().map(|t| t.uri)
    };
    let Some(uri) = uri else { return Ok(()) };

    {
        let mut rt = state.runtime.lock().map_err(|e| e.to_string())?;
        rt.forget_track(&uri);
    }

    refresh_lyrics(state).await
}
use lyra_core::domain::SettingsPatch;

#[tauri::command]
pub fn update_settings(patch: SettingsPatch, state: State<'_, AppState>, app: AppHandle) {
    let s = {
        let mut rt = lock_runtime(&state);
        let mut s = rt.settings().clone();

        if let Some(w) = patch.window {
            s.window = w;
        }
        if let Some(a) = patch.appearance {
            s.appearance = a;
        }
        if let Some(b) = patch.behavior {
            s.behavior = b;
        }

        rt.update_settings(s.clone());
        s
    };

    // Apply OS-level window flags to the main window. The overlay panels
    // (island/karaoke) manage their own click-through/level natively, so only
    // the regular main window is driven from these settings.
    crate::apply_main_window_settings(&app, &s.window);
    let _ = app.emit("app-settings-changed", s);
}

// ── System / OS integration ───────────────────────────────────────────────────

/// Info about a connected monitor, serialized for the frontend.
#[derive(Serialize, Clone)]
pub struct MonitorInfo {
    pub name: Option<String>,
    pub width: u32,
    pub height: u32,
    pub x: i32,
    pub y: i32,
    pub scale_factor: f64,
    pub is_primary: bool,
}

/// Return the list of all connected monitors with their geometry.
#[tauri::command]
pub fn get_available_monitors(app: AppHandle) -> Vec<MonitorInfo> {
    // Use any existing window to query monitor information.
    let Some(win) = app
        .get_webview_window("main")
        .or_else(|| app.get_webview_window("island"))
        .or_else(|| app.get_webview_window("settings"))
    else {
        return vec![];
    };

    let Ok(all) = win.available_monitors() else {
        return vec![];
    };

    let primary = win.primary_monitor().ok().flatten();
    let primary_pos = primary.map(|m| (m.position().x, m.position().y));

    all.into_iter()
        .map(|m| {
            let is_primary = primary_pos
                .map(|(px, py)| m.position().x == px && m.position().y == py)
                .unwrap_or(false);
            MonitorInfo {
                name: m.name().map(|s| s.to_string()),
                width: m.size().width,
                height: m.size().height,
                x: m.position().x,
                y: m.position().y,
                scale_factor: m.scale_factor(),
                is_primary,
            }
        })
        .collect()
}

/// Persist the preferred monitor and immediately reposition all surfaces onto
/// it. Resets the island's saved position so it re-centres on the new display.
#[tauri::command]
pub fn set_preferred_monitor(name: Option<String>, state: State<'_, AppState>, app: AppHandle) {
    let new_state = state.ui.mutate(|s| {
        // If the monitor is actually changing, clear the saved island position
        // so apply_preferred_monitor_positioning will centre it on the new display.
        if s.preferred_monitor != name {
            s.island_pos = None;
        }
        s.preferred_monitor = name;
    });
    crate::apply_preferred_monitor_positioning(&app, &new_state);
    let _ = app.emit("ui-settings-changed", new_state);
}

/// Called by each surface's frontend as its very first action.
///
/// Shows (or hides) the window according to persisted UiState so the native
/// frame is visible before any further IPC calls. WKWebView queues
/// `evaluateJavaScript` on hidden windows, which means invoke() responses
/// and event deliveries never arrive until the window is shown — causing a
/// deadlock when the frontend waits for data before calling show.
///
/// After applying visibility, immediately pushes the current render snapshot
/// as a `playback-tick` event so the frontend gets its first state without
/// having to wait for the next poll cycle or heartbeat.
#[tauri::command]
pub fn window_ready(label: String, state: State<'_, AppState>, app: AppHandle) {
    let ui = state.ui.snapshot();
    let configured_visible = match label.as_str() {
        "main" => ui.floating_visible,
        "island" => ui.island_visible,
        "karaoke" => ui.karaoke_visible,
        _ => false,
    };
    tray::apply_window_visibility(&app, &label, &ui);

    // Push the current snapshot immediately so the frontend doesn't spend
    // up to 10 s in the booting/loading state waiting for the first
    // poll-driven `playback-tick` emission.
    if configured_visible {
        if let Ok(render) = state.runtime.lock().map(|mut rt| rt.tick()) {
            if let Some(win) = app.get_webview_window(&label) {
                let _ = win.emit("playback-tick", render);
            }
        }
    }
}

/// Query whether autostart at login is currently enabled (delegates to the OS).
#[tauri::command]
pub fn get_autostart_status(app: AppHandle) -> bool {
    use tauri_plugin_autostart::ManagerExt;
    app.autolaunch().is_enabled().unwrap_or(false)
}

/// Enable or disable app autostart at login and persist the preference.
#[tauri::command]
pub fn set_autostart(
    enabled: bool,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), String> {
    use tauri_plugin_autostart::ManagerExt;
    if enabled {
        app.autolaunch().enable().map_err(|e| e.to_string())?;
    } else {
        app.autolaunch().disable().map_err(|e| e.to_string())?;
    }
    // Mirror into UiState so the frontend can read it from ui-settings-changed.
    let new_state = state.ui.mutate(|s| s.autostart_enabled = enabled);
    let _ = app.emit("ui-settings-changed", new_state);
    Ok(())
}
