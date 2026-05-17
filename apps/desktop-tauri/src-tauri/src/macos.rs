#![allow(unexpected_cfgs)]

use tauri::AppHandle;
use tauri::Manager;

#[cfg(target_os = "macos")]
use objc::runtime::Object;
#[cfg(target_os = "macos")]
use objc::{sel, sel_impl};
#[cfg(target_os = "macos")]
use tauri_nspanel::{ManagerExt, WebviewWindowExt};

// NSWindowLevel constants (AppKit)
#[cfg(target_os = "macos")]
const NS_FLOATING_WINDOW_LEVEL: i32 = 3;
// kCGCursorWindowLevelKey == 2147483630 (INT32_MAX - 1).
// Setting the island one step below the cursor guarantees it sits above
// every system surface (menubar, Dock, notifications, screen saver…)
// while still letting the hardware cursor render on top.
#[cfg(target_os = "macos")]
const ABOVE_EVERYTHING_LEVEL: i32 = 2147483629;
// NSNonactivatingPanelMask = 1 << 7 = 128
#[cfg(target_os = "macos")]
const NS_NONACTIVATING_PANEL_MASK: i32 = 128;

#[cfg(target_os = "macos")]
#[repr(C)]
struct CocoaPoint {
    x: f64,
    y: f64,
}

#[cfg(target_os = "macos")]
#[repr(C)]
struct CocoaSize {
    width: f64,
    height: f64,
}

#[cfg(target_os = "macos")]
#[repr(C)]
struct CocoaRect {
    origin: CocoaPoint,
    size: CocoaSize,
}

#[cfg(target_os = "macos")]
fn overlay_collection_behavior(show_on_fullscreen: bool) -> u64 {
    // NSWindowCollectionBehaviorCanJoinAllSpaces  = 1 << 0  (every space, always)
    // NSWindowCollectionBehaviorStationary        = 1 << 4  (don't animate with space switches)
    // NSWindowCollectionBehaviorIgnoresCycle      = 1 << 6  (skip Cmd+~ / Exposé cycling)
    let mut behavior: u64 = (1 << 0) | (1 << 4) | (1 << 6);
    if show_on_fullscreen {
        // NSWindowCollectionBehaviorFullScreenAuxiliary = 1 << 8
        behavior |= 1 << 8;
    }
    behavior
}

#[cfg(target_os = "macos")]
fn overlay_level(label: &str) -> i32 {
    match label {
        // Island must sit above the menubar (level 25) and every other system
        // surface. The only thing that can ever be above it is the OS cursor.
        "island" => ABOVE_EVERYTHING_LEVEL,
        _ => NS_FLOATING_WINDOW_LEVEL,
    }
}

#[cfg(target_os = "macos")]
pub fn init_overlay_panels(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window("island") {
        let _ = window.to_panel()?;
        unconstrain_from_screen(&window);
    }
    if let Some(window) = app.get_webview_window("karaoke") {
        let _ = window.to_panel()?;
        unconstrain_from_screen(&window);
    }
    Ok(())
}

/// Disable AppKit's auto-clamp that pushes windows below the menubar.
///
/// `NSWindow`'s default `-constrainFrameRect:toScreen:` clamps any window
/// frame to `[screen visibleFrame]`, which excludes the menubar/notch zone.
/// That's why panels at `NSStatusWindowLevel` still snap below the menubar
/// after `setFrameOrigin:`.
///
/// Fix: swap in a no-op implementation on the panel instance's dynamic class
/// so the requested rect is returned verbatim.
#[cfg(target_os = "macos")]
extern "C" fn unconstrained_frame_rect(
    _this: *mut Object,
    _cmd: objc::runtime::Sel,
    rect: CocoaRect,
    _screen: *mut Object,
) -> CocoaRect {
    rect
}

#[cfg(target_os = "macos")]
#[allow(clashing_extern_declarations)]
extern "C" {
    fn object_getClass(obj: *mut Object) -> *mut objc::runtime::Class;
    fn class_replaceMethod(
        cls: *mut objc::runtime::Class,
        name: objc::runtime::Sel,
        imp: objc::runtime::Imp,
        types: *const std::os::raw::c_char,
    ) -> Option<objc::runtime::Imp>;
}

#[cfg(target_os = "macos")]
fn unconstrain_from_screen(window: &tauri::WebviewWindow) {
    use objc::runtime::Sel;
    use std::ffi::CString;

    let window_clone = window.clone();
    let _ = window.run_on_main_thread(move || unsafe {
        let Ok(ns_window) = window_clone.ns_window() else {
            return;
        };
        let ns_window = ns_window as *mut Object;
        if ns_window.is_null() {
            return;
        }

        let cls: *mut objc::runtime::Class = object_getClass(ns_window);
        if cls.is_null() {
            return;
        }

        let sel: Sel = objc::sel!(constrainFrameRect:toScreen:);
        // Type encoding: returns NSRect, args (id self, SEL _cmd, NSRect, NSScreen*)
        let types = match CString::new(
            "{CGRect={CGPoint=dd}{CGSize=dd}}@:{CGRect={CGPoint=dd}{CGSize=dd}}@",
        ) {
            Ok(s) => s,
            Err(_) => return,
        };
        let imp: extern "C" fn(*mut Object, Sel, CocoaRect, *mut Object) -> CocoaRect =
            unconstrained_frame_rect;
        let _ = class_replaceMethod(
            cls,
            sel,
            std::mem::transmute::<_, objc::runtime::Imp>(imp),
            types.as_ptr(),
        );
    });
}

#[cfg(target_os = "macos")]
pub fn set_overlay_position(app: &AppHandle, label: &str, x: i32, y: i32) -> tauri::Result<()> {
    if !matches!(label, "island" | "karaoke") {
        return Ok(());
    }

    if let Some(window) = app.get_webview_window(label) {
        // 1. Fallback to Tauri's stable physical positioning to correctly target multiple monitors
        let _ = window.set_position(tauri::Position::Physical(tauri::PhysicalPosition::new(
            x, y,
        )));

        // 2. Unclamp from Apple's safe areas (which forces panels under the menubar)
        let window_clone = window.clone();
        let _ = window.run_on_main_thread(move || unsafe {
            let Ok(ns_window) = window_clone.ns_window() else {
                return;
            };
            let ns_window = ns_window as *mut Object;
            if ns_window.is_null() {
                return;
            }

            let Ok(Some(monitor)) = window_clone.current_monitor() else {
                return;
            };
            let sf = monitor.scale_factor();
            let monitor_y = monitor.position().y;

            // Calculate precise top offset in Logical Points
            let top_offset_pixels = y - monitor_y;
            let top_offset_points = top_offset_pixels as f64 / sf;

            let screen: *mut Object = objc::msg_send![ns_window, screen];
            if screen.is_null() {
                return;
            }

            let screen_frame: CocoaRect = objc::msg_send![screen, frame];
            let screen_top = screen_frame.origin.y + screen_frame.size.height;

            let window_frame: CocoaRect = objc::msg_send![ns_window, frame];

            // Override clamped Y and snap back flush to the exact requested coordinate
            let new_y = screen_top - top_offset_points - window_frame.size.height;

            let new_origin = CocoaPoint {
                x: window_frame.origin.x,
                y: new_y,
            };

            let _: () = objc::msg_send![ns_window, setFrameOrigin: new_origin];
        });
    }

    Ok(())
}

#[cfg(target_os = "macos")]
pub fn apply_overlay_visibility(
    app: &AppHandle,
    label: &str,
    visible: bool,
    show_on_fullscreen: bool,
) -> bool {
    if !matches!(label, "island" | "karaoke") {
        return false;
    }

    let Ok(panel) = app.get_webview_panel(label) else {
        return false;
    };

    // Configure semantics first — setFloatingPanel:YES internally calls
    // [panel setLevel: NSFloatingWindowLevel] which would clobber our custom
    // level, so we must call set_level AFTER set_floating_panel.
    panel.set_style_mask(NS_NONACTIVATING_PANEL_MASK);
    panel.set_floating_panel(true);
    // Override the level that setFloatingPanel just reset to NSFloatingWindowLevel (3).
    // Direct msg_send guarantees no wrapper can intercept or clamp the value.
    unsafe {
        let _: () = objc::msg_send![&*panel, setLevel: overlay_level(label)];
    }
    // Use msg_send directly to avoid the deprecated NSWindowCollectionBehavior type
    unsafe {
        let _: () = objc::msg_send![&*panel, setCollectionBehavior: overlay_collection_behavior(show_on_fullscreen)];
    }
    panel.set_hides_on_deactivate(false);
    panel.set_works_when_modal(true);
    panel.set_has_shadow(false);
    panel.set_ignore_mouse_events(label == "karaoke");

    if label == "island" {
        panel.set_becomes_key_only_if_needed(true);
    }

    if visible {
        panel.show();
    } else {
        panel.order_out(None);
    }

    true
}

#[cfg(not(target_os = "macos"))]
pub fn init_overlay_panels(_app: &AppHandle) -> tauri::Result<()> {
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn set_overlay_position(app: &AppHandle, label: &str, x: i32, y: i32) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(label) {
        let _ = window.set_position(tauri::Position::Physical(tauri::PhysicalPosition::new(
            x, y,
        )));
    }
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn apply_overlay_visibility(
    _app: &AppHandle,
    _label: &str,
    _visible: bool,
    _show_on_fullscreen: bool,
) -> bool {
    false
}

// ── Island size ────────────────────────────────────────────────────────────────

#[cfg(target_os = "macos")]
pub fn set_island_size(app: &AppHandle, width: u32, height: u32) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window("island") {
        window.set_size(tauri::Size::Physical(tauri::PhysicalSize::new(
            width, height,
        )))?;
    }
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn set_island_size(app: &AppHandle, width: u32, height: u32) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window("island") {
        let _ = window.set_size(tauri::Size::Physical(tauri::PhysicalSize::new(
            width, height,
        )));
    }
    Ok(())
}
