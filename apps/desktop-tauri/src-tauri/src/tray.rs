use std::sync::Mutex;

use lyra_core::domain::{PlaybackState, RenderSnapshot};
use lyra_core::player::PlayerCommand;
use tauri::menu::{
    CheckMenuItem, CheckMenuItemBuilder, MenuBuilder, MenuItem, MenuItemBuilder, PredefinedMenuItem,
};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, Wry};

use crate::macos;
use crate::ui_state::UiState;
use crate::AppState;

pub struct TrayMenuRefs {
    pub show_island: CheckMenuItem<Wry>,
    pub show_karaoke: CheckMenuItem<Wry>,
    pub lock_island: CheckMenuItem<Wry>,
    now_playing: MenuItem<Wry>,
    play_pause: MenuItem<Wry>,
    next: MenuItem<Wry>,
    /// Last now-playing state written to the menu, so ticks that change
    /// nothing visible don't touch it.
    shown: Mutex<Option<NowPlaying>>,
}

#[derive(Clone, PartialEq)]
struct NowPlaying {
    label: String,
    playing: bool,
    can_play_pause: bool,
    can_next: bool,
}

/// Menu titles can't wrap; keep long "title — artist" strings readable.
const NOW_PLAYING_MAX_CHARS: usize = 44;

fn now_playing_label(render: &RenderSnapshot) -> String {
    let Some(track) = render.playback.track.as_ref() else {
        return "Not playing".to_string();
    };
    let label = if track.artist.is_empty() {
        track.title.clone()
    } else {
        format!("{} — {}", track.title, track.artist)
    };
    if label.chars().count() <= NOW_PLAYING_MAX_CHARS {
        return label;
    }
    let mut short: String = label.chars().take(NOW_PLAYING_MAX_CHARS - 1).collect();
    short.push('…');
    short
}

impl TrayMenuRefs {
    pub fn sync(&self, state: &UiState) {
        let _ = self.show_island.set_checked(state.island_visible);
        let _ = self.show_karaoke.set_checked(state.karaoke_visible);
        let _ = self.lock_island.set_checked(state.island_locked);
    }

    /// Mirror the followed track and transport state into the menu-bar menu.
    pub fn sync_now_playing(&self, render: &RenderSnapshot) {
        let has_track = render.playback.track.is_some();
        let next = NowPlaying {
            label: now_playing_label(render),
            playing: render.playback.state == PlaybackState::Playing,
            can_play_pause: has_track && render.playback.caps.play_pause,
            can_next: has_track && render.playback.caps.next,
        };
        let Ok(mut shown) = self.shown.lock() else {
            return;
        };
        if shown.as_ref() == Some(&next) {
            return;
        }
        let _ = self.now_playing.set_text(&next.label);
        let _ = self
            .play_pause
            .set_text(if next.playing { "Pause" } else { "Play" });
        let _ = self.play_pause.set_enabled(next.can_play_pause);
        let _ = self.next.set_enabled(next.can_next);
        *shown = Some(next);
    }
}

pub fn create_tray(app: &AppHandle, initial: &UiState) -> tauri::Result<()> {
    // Now playing: a read-only title line, then the two controls people reach
    // for from the menu bar.
    let now_playing = MenuItemBuilder::new("Not playing")
        .id("now_playing")
        .enabled(false)
        .build(app)?;
    let play_pause = MenuItemBuilder::new("Play")
        .id("tray_play_pause")
        .enabled(false)
        .build(app)?;
    let next = MenuItemBuilder::new("Next Track")
        .id("tray_next")
        .enabled(false)
        .build(app)?;

    let show_lyra = MenuItemBuilder::new("Open Lyra")
        .id("show_lyra")
        .build(app)?;
    let show_island = CheckMenuItemBuilder::new("Show Dynamic Island")
        .id("toggle_island")
        .checked(initial.island_visible)
        .build(app)?;
    let show_karaoke = CheckMenuItemBuilder::new("Show Karaoke Lyrics")
        .id("toggle_karaoke")
        .checked(initial.karaoke_visible)
        .build(app)?;
    let lock_island = CheckMenuItemBuilder::new("Lock Dynamic Island")
        .id("toggle_island_lock")
        .checked(initial.island_locked)
        .build(app)?;

    let settings = MenuItemBuilder::new("Settings…")
        .id("settings")
        .accelerator("CmdOrCtrl+,")
        .build(app)?;
    let quit = MenuItemBuilder::new("Quit")
        .id("quit")
        .accelerator("CmdOrCtrl+Q")
        .build(app)?;

    let menu = MenuBuilder::new(app)
        .items(&[
            &now_playing,
            &play_pause,
            &next,
            &PredefinedMenuItem::separator(app)?,
            &show_lyra,
            &show_island,
            &show_karaoke,
            &PredefinedMenuItem::separator(app)?,
            &lock_island,
            &PredefinedMenuItem::separator(app)?,
            &settings,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ])
        .build()?;

    app.manage(TrayMenuRefs {
        show_island,
        show_karaoke,
        lock_island,
        now_playing,
        play_pause,
        next,
        shown: Mutex::new(None),
    });

    let mut tray = TrayIconBuilder::new()
        .menu(&menu)
        .icon_as_template(true)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "show_lyra" => open_lyra(app),
            "toggle_island" => toggle_surface(app, "island"),
            "toggle_karaoke" => toggle_surface(app, "karaoke"),
            "toggle_island_lock" => toggle_island_lock(app),
            "settings" => open_settings(app),
            "tray_play_pause" => send_command(app, PlayerCommand::PlayPause),
            "tray_next" => send_command(app, PlayerCommand::Next),
            "quit" => app.exit(0),
            _ => {}
        });

    // macOS templates use only alpha, so keep the app icon's tile out of the tray.
    #[cfg(target_os = "macos")]
    {
        tray = tray.icon(tauri::image::Image::from_bytes(include_bytes!(
            "../icons/tray-template.png"
        ))?);
    }
    #[cfg(not(target_os = "macos"))]
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }

    let _tray = tray.build(app)?;

    Ok(())
}

fn send_command(app: &AppHandle, command: PlayerCommand) {
    crate::commands::announce_skip(app, command);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let _ = crate::commands::send_player_command(app.state(), command).await;
    });
}

pub fn open_lyra(app: &AppHandle) {
    let state = app.state::<AppState>();
    let new_state = state.ui.mutate(|s| s.floating_visible = true);
    apply_window_visibility(app, "main", &new_state);
    if let Some(refs) = app.try_state::<TrayMenuRefs>() {
        refs.sync(&new_state);
    }
    let _ = app.emit("ui-settings-changed", new_state);
    // Focus only when user explicitly opens Lyra — not during autostart.
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.set_focus();
    }
}

pub fn toggle_surface(app: &AppHandle, label: &str) {
    let state = app.state::<AppState>();
    let new_state = state.ui.mutate(|s| match label {
        "main" => s.floating_visible = !s.floating_visible,
        "island" => s.island_visible = !s.island_visible,
        "karaoke" => s.karaoke_visible = !s.karaoke_visible,
        _ => {}
    });
    apply_window_visibility(app, label, &new_state);
    if let Some(refs) = app.try_state::<TrayMenuRefs>() {
        refs.sync(&new_state);
    }
    let _ = app.emit("ui-settings-changed", new_state);
}

pub fn toggle_island_lock(app: &AppHandle) {
    let state = app.state::<AppState>();
    let new_state = state.ui.mutate(|s| s.island_locked = !s.island_locked);
    if let Some(refs) = app.try_state::<TrayMenuRefs>() {
        refs.sync(&new_state);
    }
    let _ = app.emit("island-lock-changed", new_state.island_locked);
    let _ = app.emit("ui-settings-changed", new_state);
}

pub fn apply_window_visibility(app: &AppHandle, label: &str, state: &UiState) {
    let (visible, on_fullscreen) = match label {
        "main" => (state.floating_visible, state.floating_show_on_fullscreen),
        "island" => (state.island_visible, state.island_show_on_fullscreen),
        "karaoke" => (state.karaoke_visible, state.karaoke_show_on_fullscreen),
        _ => return,
    };

    if let Some(app_state) = app.try_state::<AppState>() {
        app_state.surface_visibility.set_visible(label, visible);
    }

    if label == "main" {
        sync_dock_visibility(app, state);
    }

    if macos::apply_overlay_visibility(app, label, visible, on_fullscreen) {
        return;
    }

    if let Some(window) = app.get_webview_window(label) {
        let _ = window.set_visible_on_all_workspaces(on_fullscreen);
        if visible {
            let _ = window.show();
            if label == "main" {
                let _ = window.unminimize();
            }
        } else {
            let _ = window.hide();
        }
    }
}

pub(crate) fn dock_visible_for_state(state: &UiState) -> bool {
    state.floating_visible
}

pub(crate) fn sync_dock_visibility(app: &AppHandle, state: &UiState) {
    set_dock_visible(app, dock_visible_for_state(state));
}

#[cfg(target_os = "macos")]
fn set_dock_visible(app: &AppHandle, visible: bool) {
    let _ = app.set_dock_visibility(visible);
}

#[cfg(not(target_os = "macos"))]
fn set_dock_visible(_app: &AppHandle, _visible: bool) {}

pub fn open_settings(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("settings") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[cfg(test)]
mod tests {
    use crate::ui_state::UiState;

    #[test]
    fn dock_is_regular_when_main_surface_is_visible() {
        let state = UiState {
            floating_visible: true,
            island_visible: false,
            karaoke_visible: false,
            ..UiState::default()
        };

        assert!(super::dock_visible_for_state(&state));
    }

    #[test]
    fn dock_is_accessory_when_only_menu_bar_and_overlays_remain() {
        let state = UiState {
            floating_visible: false,
            island_visible: true,
            karaoke_visible: true,
            ..UiState::default()
        };

        assert!(!super::dock_visible_for_state(&state));
    }
}
