use std::sync::Mutex;

use lyra_core::domain::{PlaybackState, RenderSnapshot};
use lyra_core::player::PlayerCommand;
use serde::Serialize;
use tauri::menu::{
    CheckMenuItem, CheckMenuItemBuilder, Menu, MenuBuilder, MenuItem, MenuItemBuilder,
    PredefinedMenuItem,
};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, EventTarget, Manager, Wry};

use crate::macos;
use crate::ui_state::UiState;
use crate::AppState;

pub struct TrayMenuRefs {
    pub show_marquee: CheckMenuItem<Wry>,
    pub show_karaoke: CheckMenuItem<Wry>,
    pub lock_marquee: CheckMenuItem<Wry>,
    now_playing: MenuItem<Wry>,
    play_pause: MenuItem<Wry>,
    next: MenuItem<Wry>,
    /// Last now-playing state written to the menu, so ticks that change
    /// nothing visible don't touch it.
    shown: Mutex<Option<NowPlaying>>,
    menu: Menu<Wry>,
    /// "Restart to Install…", added to the top of the menu once an update
    /// has downloaded.
    install_update: MenuItem<Wry>,
    install_update_separator: PredefinedMenuItem<Wry>,
    install_update_shown: Mutex<bool>,
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
        let _ = self.show_marquee.set_checked(state.marquee_visible);
        let _ = self.show_karaoke.set_checked(state.karaoke_visible);
        let _ = self.lock_marquee.set_checked(state.marquee_locked);
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

    /// Offer the downloaded update at the top of the menu.
    pub fn show_update_ready(&self, version: &str) {
        let _ = self
            .install_update
            .set_text(format!("Restart to Install Lyra {version}"));
        let Ok(mut shown) = self.install_update_shown.lock() else {
            return;
        };
        if *shown {
            return;
        }
        let added = self.menu.insert(&self.install_update, 0).is_ok()
            && self.menu.insert(&self.install_update_separator, 1).is_ok();
        *shown = added;
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
    let show_marquee = CheckMenuItemBuilder::new("Show Marquee")
        .id("toggle_marquee")
        .checked(initial.marquee_visible)
        .build(app)?;
    let show_karaoke = CheckMenuItemBuilder::new("Show Karaoke Lyrics")
        .id("toggle_karaoke")
        .checked(initial.karaoke_visible)
        .build(app)?;
    let lock_marquee = CheckMenuItemBuilder::new("Lock Marquee Position")
        .id("toggle_marquee_lock")
        .checked(initial.marquee_locked)
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
            &show_marquee,
            &show_karaoke,
            &PredefinedMenuItem::separator(app)?,
            &lock_marquee,
            &PredefinedMenuItem::separator(app)?,
            &settings,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ])
        .build()?;

    let install_update = MenuItemBuilder::new("Restart to Install Update")
        .id("install_update")
        .build(app)?;

    app.manage(TrayMenuRefs {
        show_marquee,
        show_karaoke,
        lock_marquee,
        now_playing,
        play_pause,
        next,
        shown: Mutex::new(None),
        menu: menu.clone(),
        install_update,
        install_update_separator: PredefinedMenuItem::separator(app)?,
        install_update_shown: Mutex::new(false),
    });

    let mut tray = TrayIconBuilder::new()
        .menu(&menu)
        .icon_as_template(true)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "show_lyra" => open_lyra(app),
            "toggle_marquee" => toggle_surface(app, "marquee"),
            "toggle_karaoke" => toggle_surface(app, "karaoke"),
            "toggle_marquee_lock" => toggle_marquee_lock(app),
            "settings" => open_settings(app),
            "tray_play_pause" => send_command(app, PlayerCommand::PlayPause),
            "tray_next" => send_command(app, PlayerCommand::Next),
            "install_update" => crate::updater::install_and_restart(app),
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

pub(crate) fn send_command(app: &AppHandle, command: PlayerCommand) {
    crate::commands::announce_skip(app, command);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let _ = crate::commands::send_player_command(app.state(), command).await;
    });
}

/// Normalized direction `(from_x, from_y)` pointing from the main window
/// toward the Marquee (in Y-down coordinates), so Main's reveal glides in
/// cleanly from the Marquee's side on every OS.
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
pub struct MainWindowReveal {
    pub from_x: f64,
    pub from_y: f64,
    pub was_hidden: bool,
    pub from_marquee: bool,
}

pub(crate) fn reveal_direction_from_marquee(
    marquee_rect: Option<(f64, f64, f64, f64)>,
    main_rect: Option<(f64, f64, f64, f64)>,
    dock: crate::marquee_size::DockEdges,
) -> (f64, f64) {
    if let (Some((mx, my, mw, mh)), Some((wx, wy, ww, wh))) = (marquee_rect, main_rect) {
        if mw > 1.0 && mh > 1.0 && ww > 1.0 && wh > 1.0 {
            let mcx = mx + mw * 0.5;
            let mcy = my + mh * 0.5;
            let wcx = wx + ww * 0.5;
            let wcy = wy + wh * 0.5;
            let dx = mcx - wcx;
            let dy = mcy - wcy;
            let dist = dx.hypot(dy);
            if dist >= 8.0 {
                return (dx / dist, dy / dist);
            }
        }
    }

    let fx = f64::from(i8::from(dock.right) - i8::from(dock.left));
    let fy = f64::from(i8::from(dock.bottom) - i8::from(dock.top));
    let dock_dist = fx.hypot(fy);
    if dock_dist > 0.0 {
        return (fx / dock_dist, fy / dock_dist);
    }

    // Default floating Marquee rests near bottom-center.
    (0.0, 0.85)
}

fn window_frame_for_reveal(window: &tauri::WebviewWindow) -> Option<(f64, f64, f64, f64)> {
    if let Some(frame) = macos::window_frame_global_pt(window) {
        return Some(frame);
    }
    if crate::linux::native_wayland() {
        return None;
    }
    let pos = window.outer_position().ok()?;
    let size = window.outer_size().ok()?;
    if size.width == 0 || size.height == 0 {
        return None;
    }
    Some((
        f64::from(pos.x),
        f64::from(pos.y),
        f64::from(size.width),
        f64::from(size.height),
    ))
}

pub fn open_lyra(app: &AppHandle) {
    open_lyra_inner(app, false);
}

pub fn open_lyra_from_marquee(app: &AppHandle) {
    open_lyra_inner(app, true);
}

fn open_lyra_inner(app: &AppHandle, from_marquee: bool) {
    let state = app.state::<AppState>();
    let prev_ui = state.ui.snapshot();
    let battery_saver = state
        .runtime
        .lock()
        .map(|rt| rt.settings().behavior.battery_saver)
        .unwrap_or(false);

    let main_win = app.get_webview_window("main");
    let is_minimized = main_win
        .as_ref()
        .and_then(|win| win.is_minimized().ok())
        .unwrap_or(false);
    let was_visible_native = main_win
        .as_ref()
        .and_then(|win| win.is_visible().ok())
        .unwrap_or(prev_ui.floating_visible);
    let was_hidden = !is_minimized && (!prev_ui.floating_visible || !was_visible_native);

    let (from_x, from_y) = if from_marquee {
        let marquee_rect = app
            .get_webview_window("marquee")
            .as_ref()
            .and_then(window_frame_for_reveal);
        let main_rect = main_win.as_ref().and_then(window_frame_for_reveal);
        reveal_direction_from_marquee(marquee_rect, main_rect, prev_ui.marquee_dock)
    } else {
        (0.0, 0.5)
    };

    let new_state = state.ui.mutate(|s| s.floating_visible = true);
    state.surface_visibility.set_visible("main", true);

    if let Some(win) = main_win.as_ref() {
        let _ = win.set_visible_on_all_workspaces(new_state.floating_show_on_fullscreen);
        let animate_native = was_hidden && !battery_saver && !macos::reduce_motion();
        if !(animate_native && macos::show_main_window_animated(win)) {
            macos::reset_main_window_reveal(win);
            let _ = win.show();
            let _ = win.unminimize();
            // Focus only when user explicitly opens Lyra — not during autostart.
            let _ = win.set_focus();
        }
    }
    sync_dock_visibility(app, &new_state, true);

    if let Some(refs) = app.try_state::<TrayMenuRefs>() {
        refs.sync(&new_state);
    }
    let _ = app.emit("ui-settings-changed", new_state);

    if was_hidden {
        let render = {
            let mut rt = state.runtime.lock().unwrap_or_else(|e| e.into_inner());
            rt.tick()
        };
        let _ = app.emit_to(EventTarget::webview_window("main"), "playback-tick", render);
    }

    if (was_hidden || from_marquee) && !is_minimized {
        let _ = app.emit_to(
            EventTarget::webview_window("main"),
            "main-window-reveal",
            MainWindowReveal {
                from_x,
                from_y,
                was_hidden,
                from_marquee,
            },
        );
    }
}

pub fn toggle_surface(app: &AppHandle, label: &str) {
    let state = app.state::<AppState>();
    let new_state = state.ui.mutate(|s| match label {
        "main" => s.floating_visible = !s.floating_visible,
        "marquee" => s.marquee_visible = !s.marquee_visible,
        "karaoke" => s.karaoke_visible = !s.karaoke_visible,
        _ => {}
    });
    apply_window_visibility(app, label, &new_state);
    if label == "karaoke" {
        // Out of the Karaoke lyrics' way, or back where it was.
        crate::marquee_size::place_marquee(app, None);
    }
    if let Some(refs) = app.try_state::<TrayMenuRefs>() {
        refs.sync(&new_state);
    }
    let _ = app.emit("ui-settings-changed", new_state);
}

pub fn toggle_marquee_lock(app: &AppHandle) {
    let state = app.state::<AppState>();
    let new_state = state.ui.mutate(|s| s.marquee_locked = !s.marquee_locked);
    if let Some(refs) = app.try_state::<TrayMenuRefs>() {
        refs.sync(&new_state);
    }
    let _ = app.emit("marquee-lock-changed", new_state.marquee_locked);
    let _ = app.emit("ui-settings-changed", new_state);
}

pub fn apply_window_visibility(app: &AppHandle, label: &str, state: &UiState) {
    let (visible, on_fullscreen) = match label {
        "main" => (state.floating_visible, state.floating_show_on_fullscreen),
        "marquee" => (state.marquee_visible, state.marquee_show_on_fullscreen),
        "karaoke" => (state.karaoke_visible, state.karaoke_show_on_fullscreen),
        _ => return,
    };

    if let Some(app_state) = app.try_state::<AppState>() {
        app_state.surface_visibility.set_visible(label, visible);
    }

    if macos::apply_overlay_visibility(app, label, visible, on_fullscreen) {
        return;
    }

    if let Some(window) = app.get_webview_window(label) {
        let was_visible = label == "main" && window.is_visible().unwrap_or(false);
        let _ = window.set_visible_on_all_workspaces(on_fullscreen);
        if visible {
            if label == "main" {
                macos::reset_main_window_reveal(&window);
            }
            let _ = window.show();
            if label == "main" {
                let _ = window.unminimize();
            }
        } else {
            let _ = window.hide();
            if label == "main" {
                macos::reset_main_window_reveal(&window);
            }
        }
        if label == "main" {
            sync_dock_visibility(app, state, was_visible || visible);
        }
    } else if label == "main" {
        sync_dock_visibility(app, state, false);
    }
}

pub(crate) fn dock_visible_for_state(state: &UiState) -> bool {
    state.floating_visible
}

pub(crate) fn sync_dock_visibility(app: &AppHandle, state: &UiState, defer: bool) {
    macos::sync_dock_visibility(app, dock_visible_for_state(state), defer);
}

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
            marquee_visible: false,
            karaoke_visible: false,
            ..UiState::default()
        };

        assert!(super::dock_visible_for_state(&state));
    }

    #[test]
    fn dock_is_accessory_when_only_menu_bar_and_overlays_remain() {
        let state = UiState {
            floating_visible: false,
            marquee_visible: true,
            karaoke_visible: true,
            ..UiState::default()
        };

        assert!(!super::dock_visible_for_state(&state));
    }

    #[test]
    fn reveal_direction_points_toward_marquee_above_main() {
        let (dx, dy) = super::reveal_direction_from_marquee(
            Some((300.0, 20.0, 400.0, 60.0)),
            Some((100.0, 200.0, 800.0, 600.0)),
            crate::marquee_size::DockEdges::NONE,
        );
        assert!(dx.abs() < 1e-6);
        assert!((dy - (-1.0)).abs() < 1e-6);
    }

    #[test]
    fn reveal_direction_points_toward_marquee_bottom_right() {
        let (dx, dy) = super::reveal_direction_from_marquee(
            Some((1000.0, 900.0, 400.0, 60.0)),
            Some((100.0, 200.0, 800.0, 600.0)),
            crate::marquee_size::DockEdges::NONE,
        );
        assert!(dx > 0.0);
        assert!(dy > 0.0);
        assert!((dx.hypot(dy) - 1.0).abs() < 1e-6);
    }

    #[test]
    fn reveal_direction_falls_back_to_dock_edges_on_wayland() {
        use crate::marquee_size::DockEdges;
        use std::f64::consts::FRAC_1_SQRT_2;

        assert_eq!(
            super::reveal_direction_from_marquee(
                None,
                None,
                DockEdges {
                    top: true,
                    ..DockEdges::NONE
                }
            ),
            (0.0, -1.0)
        );
        assert_eq!(
            super::reveal_direction_from_marquee(
                None,
                None,
                DockEdges {
                    bottom: true,
                    ..DockEdges::NONE
                }
            ),
            (0.0, 1.0)
        );
        assert_eq!(
            super::reveal_direction_from_marquee(
                None,
                None,
                DockEdges {
                    left: true,
                    ..DockEdges::NONE
                }
            ),
            (-1.0, 0.0)
        );
        assert_eq!(
            super::reveal_direction_from_marquee(
                None,
                None,
                DockEdges {
                    right: true,
                    ..DockEdges::NONE
                }
            ),
            (1.0, 0.0)
        );
        let (dx, dy) = super::reveal_direction_from_marquee(
            None,
            None,
            DockEdges {
                top: true,
                right: true,
                ..DockEdges::NONE
            },
        );
        assert!((dx - FRAC_1_SQRT_2).abs() < 1e-6);
        assert!((dy - (-FRAC_1_SQRT_2)).abs() < 1e-6);
    }

    #[test]
    fn reveal_direction_falls_back_when_centers_overlap_and_floating() {
        let (dx, dy) = super::reveal_direction_from_marquee(
            Some((300.0, 470.0, 400.0, 60.0)),
            Some((100.0, 200.0, 800.0, 600.0)),
            crate::marquee_size::DockEdges::NONE,
        );
        assert_eq!((dx, dy), (0.0, 0.85));
    }
}
