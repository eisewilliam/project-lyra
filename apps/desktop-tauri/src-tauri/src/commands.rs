use crate::tray;
use crate::ui_state::UiState;
use crate::AppState;
use lyra_core::{domain::{RenderSnapshot, SettingsSnapshot}, lyrics::LyricSource};
use serde::Deserialize;
use tauri::{AppHandle, Emitter, Manager, State};

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
pub fn set_show_on_fullscreen(surface: String, value: bool, state: State<'_, AppState>, app: AppHandle) {
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
        if let Some(v) = patch.show_cover { s.island_show_cover = v; }
        if let Some(v) = patch.cover_circle { s.island_cover_circle = v; }
        if let Some(v) = patch.cover_spin { s.island_cover_spin = v; }
    });
    let _ = app.emit("ui-settings-changed", new_state);
}

#[tauri::command]
pub fn update_karaoke_settings(patch: KaraokePatch, state: State<'_, AppState>, app: AppHandle) {
    let new_state = state.ui.mutate(|s| {
        if let Some(v) = patch.position { s.karaoke_position = v; }
        if let Some(v) = patch.alignment { s.karaoke_alignment = v; }
        if let Some(v) = patch.width_pct { s.karaoke_width_pct = v; }
        if let Some(v) = patch.offset_px { s.karaoke_offset_px = v; }
        if let Some(v) = patch.lines { s.karaoke_lines = v; }
        if let Some(v) = patch.bg_opacity { s.karaoke_bg_opacity = v; }
        if let Some(v) = patch.bold { s.karaoke_bold = v; }
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
    state.runtime.lock().unwrap().tick()
}

#[tauri::command]
pub fn get_all_lyrics(state: State<'_, AppState>) -> Vec<String> {
    state.runtime.lock().unwrap().all_lyrics_lines()
}

#[tauri::command]
pub fn get_all_lines(state: State<'_, AppState>) -> Vec<lyra_core::domain::LyricLine> {
    state.runtime.lock().unwrap().all_lines()
}

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> SettingsSnapshot {
    state.runtime.lock().unwrap().settings().clone()
}

#[tauri::command]
pub fn set_click_through(enabled: bool, state: State<'_, AppState>) {
    let mut rt = state.runtime.lock().unwrap();
    let mut s = rt.settings().clone();
    s.window.click_through = enabled;
    rt.update_settings(s);
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
pub async fn refresh_lyrics(state: State<'_, AppState>) -> Result<(), String> {
    // 1. Grab track + cache state without holding the lock across await.
    let (track, is_neg, already_cached) = {
        let rt = state.runtime.lock().map_err(|e| e.to_string())?;
        let track = rt.current_track();
        let (neg, cached) = track.as_ref()
            .map(|t| (rt.is_negative(&t.uri), rt.get_cached(&t.uri).is_some()))
            .unwrap_or((false, false));
        (track, neg, cached)
    };

    let Some(track) = track else { return Ok(()) };
    if is_neg || already_cached { return Ok(()); }

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
    let mut rt = state.runtime.lock().map_err(|e| e.to_string())?;
    match result {
        Ok(Some(doc)) => rt.store_lyrics(doc),
        Ok(None) | Err(_) => rt.store_negative(&track.uri),
    }
    Ok(())
}
use lyra_core::domain::SettingsPatch;

#[tauri::command]
pub fn update_settings(patch: SettingsPatch, state: State<'_, AppState>) {
    let mut rt = state.runtime.lock().unwrap();
    let mut s = rt.settings().clone();
    
    if let Some(w) = patch.window { s.window = w; }
    if let Some(a) = patch.appearance { s.appearance = a; }
    if let Some(b) = patch.behavior { s.behavior = b; }
    
    rt.update_settings(s);
}
