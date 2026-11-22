use crate::{commands, tray, AppState};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{Code, GlobalShortcut, Modifiers, Shortcut, ShortcutState};

const BINDINGS: [(Code, &str, &str); 5] = [
    (Code::KeyM, "M", "Toggle Marquee"),
    (Code::KeyK, "K", "Toggle Karaoke"),
    (Code::KeyC, "C", "Turn off click-through"),
    (Code::BracketLeft, "[", "Show lyrics earlier"),
    (Code::BracketRight, "]", "Show lyrics later"),
];

#[derive(Serialize)]
pub struct ShortcutStatus {
    available: bool,
    enabled: bool,
    bindings: Vec<BindingStatus>,
}

#[derive(Serialize)]
struct BindingStatus {
    key: &'static str,
    label: &'static str,
    registered: bool,
}

fn shortcut(key: Code) -> Shortcut {
    let command = if cfg!(target_os = "macos") {
        Modifiers::SUPER
    } else {
        Modifiers::CONTROL
    };
    Shortcut::new(Some(command | Modifiers::ALT | Modifiers::SHIFT), key)
}

pub fn init(app: &AppHandle) {
    #[cfg(target_os = "linux")]
    if crate::linux::native_wayland() {
        return;
    }

    let plugin = tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, shortcut, event| {
            if event.state() != ShortcutState::Pressed {
                return;
            }
            let key = shortcut.key;
            let handle = app.clone();
            let _ = app.run_on_main_thread(move || trigger(&handle, key));
        })
        .build();
    if let Err(error) = app.plugin(plugin) {
        log::warn!("Couldn't initialize global shortcuts: {error}");
        return;
    }
    if app
        .state::<AppState>()
        .ui
        .snapshot()
        .global_shortcuts_enabled
    {
        let _ = apply(app, true);
    }
}

fn trigger(app: &AppHandle, key: Code) {
    let state = app.state::<AppState>();
    let ui = state.ui.snapshot();
    if !ui.global_shortcuts_enabled {
        return;
    }
    match key {
        Code::KeyM => tray::toggle_surface(app, "marquee"),
        Code::KeyK => tray::toggle_surface(app, "karaoke"),
        Code::KeyC => commands::disable_click_through(app, state, ui.marquee_click_through),
        Code::BracketLeft | Code::BracketRight => {
            if [
                ("main", ui.floating_visible),
                ("marquee", ui.marquee_visible),
                ("karaoke", ui.karaoke_visible),
            ]
            .into_iter()
            .any(|(label, visible)| state.surface_visibility.is_visible(label, visible))
            {
                let delta = if key == Code::BracketLeft { -100 } else { 100 };
                commands::nudge_lyric_offset(delta, state, app.clone());
            }
        }
        _ => {}
    }
}

fn apply(app: &AppHandle, enabled: bool) -> Result<(), String> {
    let manager = app
        .try_state::<GlobalShortcut<tauri::Wry>>()
        .ok_or("Global shortcuts are unavailable on this desktop.")?;
    let mut failed_to_release = false;
    for (code, key, _) in BINDINGS {
        let shortcut = shortcut(code);
        let registered = manager.is_registered(shortcut);
        if enabled && !registered {
            if let Err(error) = manager.register(shortcut) {
                log::warn!("Couldn't register global shortcut {key}: {error}");
            }
        } else if !enabled && registered {
            if let Err(error) = manager.unregister(shortcut) {
                log::warn!("Couldn't release global shortcut {key}: {error}");
                failed_to_release = true;
            }
        }
    }
    if failed_to_release {
        return Err("Couldn't release every shortcut. Try turning them off again.".into());
    }
    Ok(())
}

#[tauri::command]
pub fn get_global_shortcuts_status(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
) -> ShortcutStatus {
    let manager = app.try_state::<GlobalShortcut<tauri::Wry>>();
    ShortcutStatus {
        available: manager.is_some(),
        enabled: state.ui.snapshot().global_shortcuts_enabled,
        bindings: BINDINGS
            .into_iter()
            .map(|(code, key, label)| BindingStatus {
                key,
                label,
                registered: manager
                    .as_ref()
                    .is_some_and(|manager| manager.is_registered(shortcut(code))),
            })
            .collect(),
    }
}

#[tauri::command]
pub fn set_global_shortcuts_enabled(
    enabled: bool,
    app: AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<ShortcutStatus, String> {
    apply(&app, enabled)?;
    let ui = state.ui.mutate(|ui| ui.global_shortcuts_enabled = enabled);
    let _ = app.emit("ui-settings-changed", ui);
    Ok(get_global_shortcuts_status(app, state))
}
