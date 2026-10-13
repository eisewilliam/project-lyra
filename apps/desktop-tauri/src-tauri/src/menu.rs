//! macOS application menu bar. Replaces Tauri's generic default so Lyra gets
//! the menus a native Mac app is expected to have: an About panel with the
//! icon, version and copyright, Check for Updates… and Settings… (⌘,) in the
//! app menu, a Playback menu whose key equivalents work from any Lyra window,
//! and a Help menu. Windows and Linux keep their undecorated windows without
//! a menu bar.

#[cfg(target_os = "macos")]
use tauri::menu::{
    AboutMetadata, Menu, MenuEvent, MenuItemBuilder, SubmenuBuilder, HELP_SUBMENU_ID,
};
#[cfg(target_os = "macos")]
use tauri::{AppHandle, Emitter, Wry};

#[cfg(target_os = "macos")]
const SETTINGS: &str = "app_settings";
#[cfg(target_os = "macos")]
const CHECK_UPDATES: &str = "app_check_updates";
#[cfg(target_os = "macos")]
const PLAY_PAUSE: &str = "playback_play_pause";
#[cfg(target_os = "macos")]
const NEXT: &str = "playback_next";
#[cfg(target_os = "macos")]
const PREVIOUS: &str = "playback_previous";
#[cfg(target_os = "macos")]
const REFRESH_LYRICS: &str = "lyrics_refresh";
#[cfg(target_os = "macos")]
const CUSTOMIZE_TOUCH_BAR: &str = "view_customize_touch_bar";
#[cfg(target_os = "macos")]
const RELEASE_NOTES: &str = "help_release_notes";
#[cfg(target_os = "macos")]
const REPORT_ISSUE: &str = "help_report_issue";

#[cfg(target_os = "macos")]
const REPOSITORY: &str = "https://github.com/eisewilliam/project-lyra";

/// Titles of Lyra's own items and the SF Symbol each shows on macOS 26,
/// where AppKit gives its standard items (About, Hide, Quit, Edit…) one.
#[cfg(target_os = "macos")]
const ITEMS: &[(&str, &str, &str)] = &[
    (SETTINGS, "Settings…", "gearshape"),
    (CHECK_UPDATES, "Check for Updates…", "arrow.down.circle"),
    (PLAY_PAUSE, "Play/Pause", "playpause"),
    (NEXT, "Next Track", "forward"),
    (PREVIOUS, "Previous Track", "backward"),
    (REFRESH_LYRICS, "Refresh Lyrics", "arrow.clockwise"),
    (CUSTOMIZE_TOUCH_BAR, "Customize Touch Bar…", "touchbar"),
    (RELEASE_NOTES, "Release Notes", "doc.text"),
    (REPORT_ISSUE, "Report an Issue…", "exclamationmark.bubble"),
];

#[cfg(target_os = "macos")]
fn title(id: &str) -> &'static str {
    ITEMS
        .iter()
        .find(|(item, _, _)| *item == id)
        .map(|(_, title, _)| *title)
        .unwrap_or_default()
}

#[cfg(target_os = "macos")]
pub fn build(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    // The bundle names the app, but a development build runs as the bare
    // `lyra-desktop` binary; name it explicitly so both read "Lyra".
    let about = AboutMetadata {
        name: Some("Lyra".into()),
        version: Some(app.package_info().version.to_string()),
        copyright: app.config().bundle.copyright.clone(),
        icon: app.default_window_icon().cloned(),
        ..Default::default()
    };
    let settings = MenuItemBuilder::with_id(SETTINGS, title(SETTINGS))
        .accelerator("Cmd+,")
        .build(app)?;
    // Greyed out where updates are off (development builds, or no signing key).
    let check_updates = MenuItemBuilder::with_id(CHECK_UPDATES, title(CHECK_UPDATES))
        .enabled(crate::updater::updates_enabled(app))
        .build(app)?;
    let app_menu = SubmenuBuilder::new(app, "Lyra")
        .about_with_text("About Lyra", Some(about))
        .item(&check_updates)
        .separator()
        .item(&settings)
        .separator()
        .services()
        .separator()
        .hide_with_text("Hide Lyra")
        .hide_others()
        .show_all()
        .separator()
        .quit_with_text("Quit Lyra")
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
    let play_pause = MenuItemBuilder::with_id(PLAY_PAUSE, title(PLAY_PAUSE)).build(app)?;
    let next = MenuItemBuilder::with_id(NEXT, title(NEXT))
        .accelerator("Cmd+Right")
        .build(app)?;
    let previous = MenuItemBuilder::with_id(PREVIOUS, title(PREVIOUS))
        .accelerator("Cmd+Left")
        .build(app)?;
    let refresh = MenuItemBuilder::with_id(REFRESH_LYRICS, title(REFRESH_LYRICS)).build(app)?;
    let playback_menu = SubmenuBuilder::new(app, "Playback")
        .item(&play_pause)
        .item(&next)
        .item(&previous)
        .separator()
        .item(&refresh)
        .build()?;

    let view_menu = SubmenuBuilder::new(app, "View").fullscreen();
    // AppKit's own automatic item is not added reliably to a menu Tauri
    // installs, so Lyra adds the same command where there is a Touch Bar.
    let view_menu = if crate::touch_bar::support().present {
        let customize =
            MenuItemBuilder::with_id(CUSTOMIZE_TOUCH_BAR, title(CUSTOMIZE_TOUCH_BAR)).build(app)?;
        view_menu.separator().item(&customize)
    } else {
        view_menu
    }
    .build()?;

    let window_menu = SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize()
        .separator()
        .close_window()
        .separator()
        .bring_all_to_front()
        .build()?;

    // The Help id makes AppKit add its search field to this menu.
    let release_notes = MenuItemBuilder::with_id(RELEASE_NOTES, title(RELEASE_NOTES)).build(app)?;
    let report_issue = MenuItemBuilder::with_id(REPORT_ISSUE, title(REPORT_ISSUE)).build(app)?;
    let help_menu = SubmenuBuilder::with_id(app, HELP_SUBMENU_ID, "Help")
        .item(&release_notes)
        .item(&report_issue)
        .build()?;

    Menu::with_items(
        app,
        &[
            &app_menu,
            &edit_menu,
            &playback_menu,
            &view_menu,
            &window_menu,
            &help_menu,
        ],
    )
}

/// Give Lyra's items the SF Symbols listed in `ITEMS`. Before macOS 26 menus
/// show no icons, so they are left plain there. Call on the main thread once
/// the menu is installed.
#[cfg(target_os = "macos")]
pub fn apply_symbols() {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSApplication, NSImage, NSMenu};
    use objc2_foundation::{NSOperatingSystemVersion, NSProcessInfo, NSString};

    fn decorate(menu: &NSMenu) {
        for item in menu.itemArray().iter() {
            let title = item.title().to_string();
            if let Some((_, _, symbol)) = ITEMS.iter().find(|(_, t, _)| *t == title) {
                let image = NSImage::imageWithSystemSymbolName_accessibilityDescription(
                    &NSString::from_str(symbol),
                    None,
                );
                if let Some(image) = image {
                    item.setImage(Some(&image));
                }
            }
            if let Some(submenu) = item.submenu() {
                decorate(&submenu);
            }
        }
    }

    let Some(mtm) = MainThreadMarker::new() else {
        return;
    };
    let tahoe = NSOperatingSystemVersion {
        majorVersion: 26,
        minorVersion: 0,
        patchVersion: 0,
    };
    if !NSProcessInfo::processInfo().isOperatingSystemAtLeastVersion(tahoe) {
        return;
    }
    if let Some(main_menu) = NSApplication::sharedApplication(mtm).mainMenu() {
        decorate(&main_menu);
    }
}

#[cfg(target_os = "macos")]
fn open_url(url: &str) {
    let _ = std::process::Command::new("open").arg(url).spawn();
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
        CHECK_UPDATES => {
            // The update's progress and Install button live in General.
            crate::tray::open_settings(app);
            let _ = app.emit_to(
                tauri::EventTarget::webview_window("settings"),
                "settings-show-section",
                "general",
            );
            crate::updater::check_for_updates(app.clone());
            return;
        }
        RELEASE_NOTES => {
            open_url(&format!("{REPOSITORY}/releases"));
            return;
        }
        REPORT_ISSUE => {
            open_url(&format!("{REPOSITORY}/issues/new"));
            return;
        }
        CUSTOMIZE_TOUCH_BAR => {
            crate::touch_bar::customize(app);
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
