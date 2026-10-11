//! macOS application menu bar. Replaces Tauri's generic default so Lyra gets
//! the menus a native Mac app is expected to have: Settings… (⌘,) in the app
//! menu and a Playback menu whose key equivalents work from any Lyra window.
//! Windows and Linux keep their undecorated windows without a menu bar.

#[cfg(target_os = "macos")]
use tauri::menu::{Menu, MenuEvent, MenuItemBuilder, SubmenuBuilder};
#[cfg(target_os = "macos")]
use tauri::{AppHandle, Wry};

#[cfg(target_os = "macos")]
const SETTINGS: &str = "app_settings";
#[cfg(target_os = "macos")]
const PLAY_PAUSE: &str = "playback_play_pause";
#[cfg(target_os = "macos")]
const NEXT: &str = "playback_next";
#[cfg(target_os = "macos")]
const PREVIOUS: &str = "playback_previous";
#[cfg(target_os = "macos")]
const REFRESH_LYRICS: &str = "lyrics_refresh";

#[cfg(target_os = "macos")]
pub fn build(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let settings = MenuItemBuilder::with_id(SETTINGS, "Settings…")
        .accelerator("Cmd+,")
        .build(app)?;
    let app_menu = SubmenuBuilder::new(app, "Lyra")
        .about(None)
        .separator()
        .item(&settings)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;

    // Native text editing shortcuts (⌘C/⌘V/⌘A…) in WKWebView are routed
    // through the Edit menu; without it the settings inputs lose them.
    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    // Space is handled inside the main window so it never steals typing in
    // settings fields; it is listed here for discoverability only.
    let play_pause = MenuItemBuilder::with_id(PLAY_PAUSE, "Play/Pause").build(app)?;
    let next = MenuItemBuilder::with_id(NEXT, "Next Track")
        .accelerator("Cmd+Right")
        .build(app)?;
    let previous = MenuItemBuilder::with_id(PREVIOUS, "Previous Track")
        .accelerator("Cmd+Left")
        .build(app)?;
    let refresh = MenuItemBuilder::with_id(REFRESH_LYRICS, "Refresh Lyrics").build(app)?;
    let playback_menu = SubmenuBuilder::new(app, "Playback")
        .item(&play_pause)
        .item(&next)
        .item(&previous)
        .separator()
        .item(&refresh)
        .build()?;

    let view_menu = SubmenuBuilder::new(app, "View").fullscreen().build()?;

    let window_menu = SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize()
        .separator()
        .close_window()
        .separator()
        .bring_all_to_front()
        .build()?;

    Menu::with_items(
        app,
        &[
            &app_menu,
            &edit_menu,
            &playback_menu,
            &view_menu,
            &window_menu,
        ],
    )
}

/// Menu events are app-global (tray events arrive here too), so unknown ids
/// are ignored and left to the tray handler.
#[cfg(target_os = "macos")]
pub fn handle_event(app: &AppHandle, event: MenuEvent) {
    use lyra_core::player::PlayerCommand;
    use tauri::async_runtime::spawn;
    use tauri::Manager;

    let command = match event.id().as_ref() {
        SETTINGS => {
            crate::tray::open_settings(app);
            return;
        }
        REFRESH_LYRICS => {
            let app = app.clone();
            spawn(async move {
                let state = app.state::<crate::AppState>();
                let _ = state.lyrics.force_refresh(&state.runtime).await;
            });
            return;
        }
        PLAY_PAUSE => PlayerCommand::PlayPause,
        NEXT => PlayerCommand::Next,
        PREVIOUS => PlayerCommand::Previous,
        _ => return,
    };
    crate::commands::announce_skip(app, command);
    let app = app.clone();
    spawn(async move {
        let _ = crate::commands::send_player_command(app.state(), command).await;
    });
}
