use crate::island_size;
use crate::tray;
use crate::ui_state::UiState;
use crate::AppState;
use lyra_core::domain::{
    BrowserLyrics, FollowRule, KnownPlayerInfo, MediaPolicyView, PlayerSessionInfo, RenderSnapshot,
    SettingsSnapshot,
};
use lyra_core::player::PlayerCommand;
use serde::{Deserialize, Serialize};
use std::sync::{Arc, MutexGuard};
use tauri::{AppHandle, Emitter, Manager, State};

use lyra_core::runtime::LyraRuntime;

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
    if label == "settings" {
        tray::open_settings(&app);
    } else {
        tray::toggle_surface(&app, &label);
    }
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

/// Position lock only: a locked island can't be dragged but still responds
/// to hover and clicks. Click-through is a separate setting.
#[tauri::command]
pub fn set_island_locked(locked: bool, state: State<'_, AppState>, app: AppHandle) {
    let new_state = state.ui.mutate(|s| s.island_locked = locked);
    if let Some(refs) = app.try_state::<tray::TrayMenuRefs>() {
        refs.sync(&new_state);
    }
    let _ = app.emit("island-lock-changed", new_state.island_locked);
    let _ = app.emit("ui-settings-changed", new_state);
}

/// Let clicks pass through the island to whatever is behind it. Disables
/// hover controls and click actions on the island.
#[tauri::command]
pub fn set_island_click_through(enabled: bool, state: State<'_, AppState>, app: AppHandle) {
    let new_state = state.ui.mutate(|s| s.island_click_through = enabled);
    if let Some(island) = app.get_webview_window("island") {
        let _ = island.set_ignore_cursor_events(enabled);
    }
    let _ = app.emit("ui-settings-changed", new_state);
}

/// Whether this Mac has a Touch Bar and Lyra can add its Control Strip
/// button. Sync so it runs on the main thread.
#[tauri::command]
pub fn get_touch_bar_support() -> crate::touch_bar::Support {
    crate::touch_bar::support()
}

/// Show a menu with SF Symbols and second lines at a point in the window,
/// or at the pointer, and return the chosen row's id. macOS only; elsewhere
/// the web view uses Tauri's menu.
#[tauri::command]
pub async fn show_native_menu(
    window: tauri::WebviewWindow,
    items: Vec<crate::native_menu::NativeMenuItem>,
    x: Option<f64>,
    y: Option<f64>,
) -> Result<Option<String>, String> {
    crate::native_menu::show(&window, items, x.zip(y)).await
}

/// Open AppKit's palette for arranging Lyra's Touch Bar, the same as View →
/// Customize Touch Bar…, from Settings → Touch Bar.
#[tauri::command]
pub fn customize_touch_bar(app: AppHandle) {
    crate::touch_bar::customize(&app);
}

/// Add or remove Lyra's Control Strip button, which shows the lyrics bar
/// over any app.
#[tauri::command]
pub fn set_touch_bar_control_strip(enabled: bool, state: State<'_, AppState>, app: AppHandle) {
    let new_state = state.ui.mutate(|s| s.touch_bar_control_strip = enabled);
    crate::touch_bar::set_control_strip(&app, enabled);
    let _ = app.emit("ui-settings-changed", new_state);
}

/// Put lyric text on the system clipboard. Runs on the host because the
/// lyric line menu's actions arrive without a user gesture, which the web
/// clipboard API requires.
#[tauri::command]
pub fn copy_text(text: String, app: AppHandle) -> Result<(), String> {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    app.clipboard().write_text(text).map_err(|e| e.to_string())
}

/// Whether the pointer is over the island (macOS hover safety check). Sync so
/// it runs on the main thread, where AppKit state may be read.
#[tauri::command]
pub fn island_pointer_inside(app: AppHandle) -> bool {
    #[cfg(target_os = "macos")]
    {
        crate::macos::island_pointer_inside(&app)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        true
    }
}

/// Show and focus the main window (from the island or the first-run card).
#[tauri::command]
pub fn open_main_window(app: AppHandle) {
    tray::open_lyra(&app);
}

/// Record that the first-run explanation was acknowledged, then poll the
/// players immediately: AppleScript readers wait for this before asking
/// macOS for permission to control Spotify and Music.
#[tauri::command]
pub fn complete_onboarding(state: State<'_, AppState>, app: AppHandle) {
    let new_state = state.ui.mutate(|s| s.onboarded = true);
    #[cfg(target_os = "macos")]
    lyra_core::player::set_automation_enabled(true);
    state.poll.request_poll();
    let _ = app.emit("ui-settings-changed", new_state);
}

/// Players macOS refused to let Lyra control (Automation permission), by
/// display name. Empty elsewhere and when nothing was refused.
#[tauri::command]
pub fn get_automation_denied() -> Vec<String> {
    #[cfg(target_os = "macos")]
    {
        lyra_core::player::automation_denied()
    }
    #[cfg(not(target_os = "macos"))]
    {
        Vec::new()
    }
}

/// Open System Settings at Privacy & Security → Automation.
#[tauri::command]
pub fn open_automation_settings() {
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("/usr/bin/open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Automation")
            .spawn();
    }
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
    pub transparency: Option<f32>,
    /// A size from `island_size::SCALE_STEPS`.
    pub scale: Option<f32>,
    /// `true` returns the size to matching the display.
    pub match_screen: Option<bool>,
    pub base_width: Option<u32>,
    pub lines: Option<u8>,
}

impl IslandPatch {
    fn changes_size(&self) -> bool {
        self.scale.is_some()
            || self.match_screen.is_some()
            || self.base_width.is_some()
            || self.lines.is_some()
    }
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
        if let Some(v) = patch.transparency.filter(|v| v.is_finite()) {
            s.island_transparency = v.clamp(0.0, 1.0);
        }
        if let Some(v) = patch.scale.filter(|v| v.is_finite()) {
            s.island_scale = Some(island_size::nearest_step(v));
        }
        if patch.match_screen == Some(true) {
            s.island_scale = None;
        }
        if let Some(v) = patch.base_width {
            s.island_base_width = v.clamp(island_size::MIN_BASE_WIDTH, island_size::MAX_BASE_WIDTH);
        }
        if let Some(v) = patch.lines {
            s.island_lines = v.clamp(1, 2);
        }
    });
    let _ = app.emit("ui-settings-changed", new_state);
    if patch.changes_size() {
        island_size::fit_island(&app, true);
    }
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
pub fn save_island_position(x: i32, y: i32, state: State<'_, AppState>, app: tauri::AppHandle) {
    let new_state = state.ui.mutate(|s| {
        s.island_pos = if x == -1 { None } else { Some((x, y)) };
    });
    let _ = app.emit("ui-settings-changed", &new_state);
    if x == -1 {
        crate::apply_preferred_monitor_positioning(&app, &new_state);
    }
}

/// The island's size on its current display, once it has been fitted. Changes
/// arrive as `island-frame` events.
#[tauri::command]
pub fn get_island_frame(state: State<'_, AppState>) -> Option<island_size::IslandFrame> {
    state.island_fit.current()
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
pub fn get_plain_lyrics(state: State<'_, AppState>) -> Option<String> {
    lock_runtime(&state).all_plain_lyrics()
}

#[tauri::command]
pub fn get_all_lines(state: State<'_, AppState>) -> Vec<lyra_core::runtime::LyricLineSlim> {
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

/// Tell the main window a skip came from a native menu, so it shows the same
/// direction-aware feedback as its own buttons and shortcuts.
pub(crate) fn announce_skip(app: &AppHandle, command: PlayerCommand) {
    let direction: i8 = match command {
        PlayerCommand::Next => 1,
        PlayerCommand::Previous => -1,
        _ => return,
    };
    let _ = app.emit_to(
        tauri::EventTarget::webview_window("main"),
        "transport-skip",
        direction,
    );
}

/// Send a command to the followed player. Adapter calls block on OS IPC
/// (AppleScript, WinRT, D-Bus), so they run on the blocking pool instead of
/// the main thread. Playback changes then request an immediate adapter poll
/// so every surface reflects them without waiting for the next tick.
pub(crate) async fn send_player_command(
    state: State<'_, AppState>,
    command: PlayerCommand,
) -> Result<(), String> {
    let players = Arc::clone(&state.players);
    let result = tauri::async_runtime::spawn_blocking(move || players.control(command))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string());
    if !matches!(command, PlayerCommand::Raise) {
        state.poll.request_poll();
    }
    result
}

#[tauri::command]
pub async fn playback_play_pause(state: State<'_, AppState>) -> Result<(), String> {
    send_player_command(state, PlayerCommand::PlayPause).await
}

#[tauri::command]
pub async fn playback_next(state: State<'_, AppState>) -> Result<(), String> {
    send_player_command(state, PlayerCommand::Next).await
}

#[tauri::command]
pub async fn playback_previous(state: State<'_, AppState>) -> Result<(), String> {
    send_player_command(state, PlayerCommand::Previous).await
}

#[tauri::command]
pub async fn playback_seek_ms(position_ms: u64, state: State<'_, AppState>) -> Result<(), String> {
    send_player_command(state, PlayerCommand::SeekMs(position_ms)).await
}

/// Bring the followed player to the front, showing the current track where
/// the player allows it.
#[tauri::command]
pub async fn playback_raise(state: State<'_, AppState>) -> Result<(), String> {
    send_player_command(state, PlayerCommand::Raise).await
}

/// Every playback session the adapters saw in the latest poll, for the
/// player diagnostics view.
#[tauri::command]
pub fn get_player_sessions(state: State<'_, AppState>) -> Vec<PlayerSessionInfo> {
    state.players.sessions()
}

#[tauri::command]
pub async fn clear_lyrics_cache(state: tauri::State<'_, AppState>) -> Result<(), String> {
    let cache = {
        let rt = lock_runtime(&state);
        rt.cache.clone()
    };
    tokio::task::spawn_blocking(move || cache.clear())
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn refresh_lyrics(state: State<'_, AppState>) -> Result<(), String> {
    state.lyrics.refresh(&state.runtime).await
}

/// Retry the currently playing track through the core lyric coordinator.
#[tauri::command]
pub async fn force_refresh_lyrics(state: State<'_, AppState>) -> Result<(), String> {
    state.lyrics.force_refresh(&state.runtime).await
}
use lyra_core::domain::SettingsPatch;

#[tauri::command]
pub fn update_settings(patch: SettingsPatch, state: State<'_, AppState>, app: AppHandle) {
    let behavior_changed = patch.behavior.is_some();
    let (s, battery_saver_was) = {
        let mut rt = lock_runtime(&state);
        let mut s = rt.settings().clone();
        let battery_saver_was = s.behavior.battery_saver;

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
        (s, battery_saver_was)
    };

    // Apply OS-level window flags to the main window. The overlay panels
    // (island/karaoke) manage their own click-through/level natively, so only
    // the regular main window is driven from these settings.
    crate::apply_main_window_settings(&app, &s.window);
    // Battery saver drops the island's glass along with the CSS effects.
    if s.behavior.battery_saver != battery_saver_was {
        crate::macos::set_island_glass(&app, !s.behavior.battery_saver);
    }
    state
        .players
        .set_lookups_allowed(s.behavior.browser_lyrics == BrowserLyrics::Allow);
    let _ = app.emit("app-settings-changed", s);
    // Behaviour settings (e.g. browser lyric consent) change what is
    // followed and the lyric status.
    if behavior_changed {
        crate::refresh_playback_now(&app);
    }
}

/// Record the user's answer to the browser-media lyric lookup prompt, then
/// broadcast settings and a fresh snapshot so surfaces update immediately.
#[tauri::command]
pub fn set_browser_lyrics(choice: BrowserLyrics, state: State<'_, AppState>, app: AppHandle) {
    let settings = {
        let mut rt = lock_runtime(&state);
        let mut settings = rt.settings().clone();
        settings.behavior.browser_lyrics = choice;
        rt.update_settings(settings.clone());
        settings
    };
    state
        .players
        .set_lookups_allowed(choice == BrowserLyrics::Allow);
    let _ = app.emit("app-settings-changed", settings);
    crate::refresh_playback_now(&app);
}

// ── Media following rules ─────────────────────────────────────────────────────

#[tauri::command]
pub fn get_media_policy(state: State<'_, AppState>) -> MediaPolicyView {
    state.players.media_policy()
}

/// Broadcast the new policy and apply it to playback before returning, so
/// callers that re-read sessions see the effect.
async fn policy_changed(
    app: AppHandle,
    view: Result<MediaPolicyView, String>,
) -> Result<MediaPolicyView, String> {
    let view = view?;
    let _ = app.emit("media-policy-changed", &view);
    crate::refresh_playback(app).await;
    Ok(view)
}

/// Every player Lyra has seen, including ones not running now.
#[tauri::command]
pub fn get_known_players(state: State<'_, AppState>) -> Vec<KnownPlayerInfo> {
    state.players.known_players()
}

/// Forget a player and its settings; it reappears if it plays again.
#[tauri::command]
pub async fn forget_player(
    app_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<MediaPolicyView, String> {
    let view = state
        .players
        .forget_player(&app_id)
        .map_err(|e| e.to_string());
    policy_changed(app, view).await
}

/// Follow only `app_id`, or select players automatically (`null`).
#[tauri::command]
pub async fn set_pinned_app(
    app_id: Option<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<MediaPolicyView, String> {
    let view = state
        .players
        .set_pinned_app(app_id.as_deref())
        .map_err(|e| e.to_string());
    policy_changed(app, view).await
}

/// `false` follows every media session, music or not.
#[tauri::command]
pub async fn set_only_music(
    only_music: bool,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<MediaPolicyView, String> {
    let view = state
        .players
        .set_only_music(only_music)
        .map_err(|e| e.to_string());
    policy_changed(app, view).await
}

#[tauri::command]
pub async fn set_app_rule(
    app_id: String,
    rule: FollowRule,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<MediaPolicyView, String> {
    let view = state
        .players
        .set_app_rule(&app_id, rule)
        .map_err(|e| e.to_string());
    policy_changed(app, view).await
}

/// Mark one track as music (`true`), not music (`false`), or clear (`null`).
#[tauri::command]
pub async fn set_track_override(
    track_key: String,
    is_music: Option<bool>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<MediaPolicyView, String> {
    let view = state
        .players
        .set_track_override(&track_key, is_music)
        .map_err(|e| e.to_string());
    policy_changed(app, view).await
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
    state.surface_visibility.set_ready(&label);

    let ui = state.ui.snapshot();
    let configured_visible = match label.as_str() {
        "main" => ui.floating_visible,
        "island" => ui.island_visible,
        "karaoke" => ui.karaoke_visible,
        _ => false,
    };
    tray::apply_window_visibility(&app, &label, &ui);

    // Karaoke is a display-only overlay — always click-through.
    // Island is click-through only when the user turned that on.
    // Deferred here (rather than in `setup()`) because the window must be
    // realized — i.e. shown and backed by an actual GTK/gdk surface on
    // Linux — before `set_ignore_cursor_events` is safe to call. `setup()`
    // runs before that's guaranteed; `window_ready` fires only after the
    // frontend has mounted, by which point the window has been shown.
    match label.as_str() {
        "karaoke" => {
            if let Some(win) = app.get_webview_window(&label) {
                crate::linux::apply_ignore_cursor_events_when_ready(&win, true);
            }
        }
        "island" => {
            if let Some(win) = app.get_webview_window(&label) {
                crate::linux::apply_ignore_cursor_events_when_ready(&win, ui.island_click_through);
                crate::macos::sync_island_glass_state(&win);
            }
        }
        _ => {}
    }

    // Push the current snapshot immediately so the frontend doesn't spend
    // up to 10 s in the booting/loading state waiting for the first
    // poll-driven `playback-tick` emission.
    if configured_visible {
        emit_snapshot_to(&app, &state, &label);
    }
}

/// Push the current render snapshot to one surface. `Emitter::emit` on a
/// window broadcasts to every webview, so target the label explicitly.
fn emit_snapshot_to(app: &AppHandle, state: &State<'_, AppState>, label: &str) {
    let render = lock_runtime(state).tick();
    let _ = app.emit_to(
        tauri::EventTarget::webview_window(label),
        "playback-tick",
        render,
    );
}

/// Each playback surface reports its page visibility. A surface that is
/// minimized, fully covered, on another Space or behind the lock screen stops
/// receiving ticks, and when every surface is hidden the poll loop stops
/// calling the player entirely. Becoming visible again triggers an immediate
/// poll and pushes the current snapshot so the surface never shows stale state.
#[tauri::command]
pub fn set_surface_occluded(
    label: String,
    occluded: bool,
    state: State<'_, AppState>,
    app: AppHandle,
) {
    if !matches!(label.as_str(), "main" | "island" | "karaoke") {
        return;
    }
    // Rare, and a surface that stops updating is first explained here.
    log::info!(
        "{label} page reported {}",
        if occluded { "hidden" } else { "visible" }
    );
    state.surface_visibility.set_occluded(&label, occluded);
    if !occluded {
        state.poll.request_poll();
        emit_snapshot_to(&app, &state, &label);
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
