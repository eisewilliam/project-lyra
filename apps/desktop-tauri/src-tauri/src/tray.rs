use tauri::menu::{
    CheckMenuItem, CheckMenuItemBuilder, MenuBuilder, MenuItemBuilder, PredefinedMenuItem,
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
}

impl TrayMenuRefs {
    pub fn sync(&self, state: &UiState) {
        let _ = self.show_island.set_checked(state.island_visible);
        let _ = self.show_karaoke.set_checked(state.karaoke_visible);
        let _ = self.lock_island.set_checked(state.island_locked);
    }
}

pub fn create_tray(app: &AppHandle, initial: &UiState) -> tauri::Result<()> {
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

    let settings = MenuItemBuilder::new("Settings...")
        .id("settings")
        .accelerator("CmdOrCtrl+,")
        .build(app)?;
    let quit = MenuItemBuilder::new("Quit")
        .id("quit")
        .accelerator("CmdOrCtrl+Q")
        .build(app)?;

    let menu = MenuBuilder::new(app)
        .items(&[
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
            "quit" => app.exit(0),
            _ => {}
        });

    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }

    let _tray = tray.build(app)?;

    Ok(())
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
