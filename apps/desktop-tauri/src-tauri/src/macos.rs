use tauri::AppHandle;
use tauri::Manager;

#[cfg(target_os = "macos")]
use objc2::ffi::{
    objc_getAssociatedObject, objc_setAssociatedObject, OBJC_ASSOCIATION_RETAIN_NONATOMIC,
};
#[cfg(target_os = "macos")]
use objc2::rc::Retained;
#[cfg(target_os = "macos")]
use objc2::runtime::{AnyClass, AnyObject, Bool, Imp, Sel};
#[cfg(target_os = "macos")]
use objc2::{define_class, msg_send, sel, AllocAnyThread, MainThreadMarker, MainThreadOnly};
#[cfg(target_os = "macos")]
use objc2_app_kit::{
    NSAppearance, NSAppearanceCustomization, NSAppearanceNameDarkAqua, NSEvent, NSTrackingArea,
    NSTrackingAreaOptions, NSWindow, NSWindowCollectionBehavior, NSWindowStyleMask, NSWorkspace,
    NSWorkspaceAccessibilityDisplayOptionsDidChangeNotification,
};
#[cfg(target_os = "macos")]
use objc2_foundation::{NSNotification, NSObject, NSObjectProtocol, NSPoint, NSRect};
#[cfg(target_os = "macos")]
use std::sync::atomic::{AtomicBool, Ordering};
#[cfg(target_os = "macos")]
use tauri_nspanel::{ManagerExt, WebviewWindowExt};

// NSWindowLevel constants (AppKit)
#[cfg(target_os = "macos")]
const NS_FLOATING_WINDOW_LEVEL: i64 = 3;
// kCGCursorWindowLevelKey == 2147483630 (INT32_MAX - 1).
// Setting the island one step below the cursor guarantees it sits above
// every system surface (menubar, Dock, notifications, screen saver…)
// while still letting the hardware cursor render on top.
#[cfg(target_os = "macos")]
const ABOVE_EVERYTHING_LEVEL: i64 = 2147483629;

/// The NSPanel subclass the island and karaoke windows become. The macro
/// brings its own imports, so it lives in a module of its own.
#[cfg(target_os = "macos")]
mod overlay_panel {
    tauri_nspanel::tauri_panel! {
        panel!(LyraOverlayPanel {
            config: {
                can_become_key_window: true
            }
        })
    }
}

#[cfg(target_os = "macos")]
use overlay_panel::LyraOverlayPanel;

#[cfg(target_os = "macos")]
fn overlay_collection_behavior(show_on_fullscreen: bool) -> NSWindowCollectionBehavior {
    // Every space, without animating on space switches or joining the
    // Cmd+~ / Exposé cycle.
    let mut behavior = NSWindowCollectionBehavior::CanJoinAllSpaces
        | NSWindowCollectionBehavior::Stationary
        | NSWindowCollectionBehavior::IgnoresCycle;
    if show_on_fullscreen {
        behavior |= NSWindowCollectionBehavior::FullScreenAuxiliary;
    }
    behavior
}

#[cfg(target_os = "macos")]
fn overlay_level(label: &str) -> i64 {
    match label {
        // Island must sit above the menubar (level 25) and every other system
        // surface. The only thing that can ever be above it is the OS cursor.
        "island" => ABOVE_EVERYTHING_LEVEL,
        _ => NS_FLOATING_WINDOW_LEVEL,
    }
}

/// The window's NSWindow. Call on the main thread.
#[cfg(target_os = "macos")]
fn ns_window(window: &tauri::WebviewWindow) -> Option<Retained<NSWindow>> {
    let ptr = window.ns_window().ok()?.cast::<NSWindow>();
    // SAFETY: Tauri returns the window's live NSWindow, or null.
    unsafe { Retained::retain(ptr) }
}

#[cfg(target_os = "macos")]
pub fn init_overlay_panels(app: &AppHandle, island_glass: bool) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window("island") {
        let _ = window.to_panel::<LyraOverlayPanel>()?;
        unconstrain_from_screen(&window);
        keep_glass_active(&window);
        track_island_hover(app, &window);
        set_dark_appearance(&window);
        set_island_glass(app, island_glass);
    }
    if let Some(window) = app.get_webview_window("karaoke") {
        let _ = window.to_panel::<LyraOverlayPanel>()?;
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
/// Fix: install a no-op implementation on the panel's class so the requested
/// rect is returned verbatim.
#[cfg(target_os = "macos")]
unsafe extern "C-unwind" fn unconstrained_frame_rect(
    _this: *mut AnyObject,
    _cmd: Sel,
    rect: NSRect,
    _screen: *mut AnyObject,
) -> NSRect {
    rect
}

/// Type encoding for `- (NSRect)constrainFrameRect:(NSRect)rect toScreen:(NSScreen *)screen`.
#[cfg(target_os = "macos")]
const CONSTRAIN_FRAME_RECT_TYPES: &std::ffi::CStr =
    c"{CGRect={CGPoint=dd}{CGSize=dd}}@:{CGRect={CGPoint=dd}{CGSize=dd}}@";

#[cfg(target_os = "macos")]
fn unconstrain_from_screen(window: &tauri::WebviewWindow) {
    let window_clone = window.clone();
    let _ = window.run_on_main_thread(move || {
        let Some(ns_window) = ns_window(&window_clone) else {
            return;
        };
        let object: &AnyObject = &ns_window;
        let class: *const AnyClass = object.class();
        let imp: unsafe extern "C-unwind" fn(
            *mut AnyObject,
            Sel,
            NSRect,
            *mut AnyObject,
        ) -> NSRect = unconstrained_frame_rect;
        // SAFETY: the function matches the selector's signature, described by
        // the type encoding; method implementations are stored erased as `Imp`.
        unsafe {
            let imp = std::mem::transmute::<
                unsafe extern "C-unwind" fn(*mut AnyObject, Sel, NSRect, *mut AnyObject) -> NSRect,
                Imp,
            >(imp);
            objc2::ffi::class_replaceMethod(
                class.cast_mut(),
                sel!(constrainFrameRect:toScreen:),
                imp,
                CONSTRAIN_FRAME_RECT_TYPES.as_ptr(),
            );
        }
    });
}

/// Liquid Glass in a window that isn't key draws a grey, frosted "inactive"
/// veil, and the island is a non-activating panel that is almost never key.
/// AppKit asks these two private methods whether a window draws the active
/// look; its own menu windows answer YES the same way. They are installed on
/// the overlay panel class, so the karaoke panel (which has no glass) gets
/// them too. Where macOS lacks them they are never called and the glass
/// keeps the inactive look; focus and key status are unchanged.
#[cfg(target_os = "macos")]
unsafe extern "C-unwind" fn always_active_appearance(_this: *mut AnyObject, _cmd: Sel) -> Bool {
    Bool::YES
}

/// Type encoding for a `- (BOOL)method` getter; `BOOL` is `bool` on arm64
/// and `signed char` on x86_64.
#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
const BOOL_GETTER_TYPES: &std::ffi::CStr = c"B@:";
#[cfg(all(target_os = "macos", not(target_arch = "aarch64")))]
const BOOL_GETTER_TYPES: &std::ffi::CStr = c"c@:";

#[cfg(target_os = "macos")]
fn keep_glass_active(window: &tauri::WebviewWindow) {
    let window_clone = window.clone();
    let _ = window.run_on_main_thread(move || {
        let Some(ns_window) = ns_window(&window_clone) else {
            return;
        };
        let object: &AnyObject = &ns_window;
        let class: *const AnyClass = object.class();
        let imp: unsafe extern "C-unwind" fn(*mut AnyObject, Sel) -> Bool =
            always_active_appearance;
        // SAFETY: the function matches a BOOL getter, described by the type
        // encoding; method implementations are stored erased as `Imp`.
        unsafe {
            let imp = std::mem::transmute::<
                unsafe extern "C-unwind" fn(*mut AnyObject, Sel) -> Bool,
                Imp,
            >(imp);
            for selector in [
                sel!(_hasActiveAppearance),
                sel!(_hasActiveAppearanceIgnoringKeyFocus),
            ] {
                objc2::ffi::class_replaceMethod(
                    class.cast_mut(),
                    selector,
                    imp,
                    BOOL_GETTER_TYPES.as_ptr(),
                );
            }
        }
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
        let _ = window.run_on_main_thread(move || {
            let Some(ns_window) = ns_window(&window_clone) else {
                return;
            };
            let Ok(Some(monitor)) = window_clone.current_monitor() else {
                return;
            };
            let sf = monitor.scale_factor();
            let monitor_y = monitor.position().y;

            // Calculate precise top offset in Logical Points
            let top_offset_pixels = y - monitor_y;
            let top_offset_points = top_offset_pixels as f64 / sf;

            let Some(screen) = ns_window.screen() else {
                return;
            };
            let screen_frame = screen.frame();
            let screen_top = screen_frame.origin.y + screen_frame.size.height;
            let window_frame = ns_window.frame();

            // Override clamped Y and snap back flush to the exact requested coordinate
            let new_y = screen_top - top_offset_points - window_frame.size.height;
            ns_window.setFrameOrigin(NSPoint::new(window_frame.origin.x, new_y));

            if window_clone.label() == "island" {
                let docked = top_offset_points.abs() < 0.5;
                if ISLAND_DOCKED.swap(docked, Ordering::AcqRel) != docked {
                    fit_island_glass(&ns_window, docked);
                }
            }
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
    let _ = panel.set_style_mask(NSWindowStyleMask::NonactivatingPanel);
    panel.set_floating_panel(true);
    panel.set_level(overlay_level(label));
    panel.set_collection_behavior(overlay_collection_behavior(show_on_fullscreen));
    panel.set_hides_on_deactivate(false);
    panel.set_works_when_modal(true);
    panel.set_has_shadow(false);
    panel.set_ignores_mouse_events(label == "karaoke");

    if label == "island" {
        panel.set_becomes_key_only_if_needed(true);
    }

    if visible {
        panel.show();
    } else {
        panel.hide();
    }

    true
}

// ── Island hover ───────────────────────────────────────────────────────────────
//
// The island is a non-activating panel, so while another app is active WebKit
// may not deliver mouse-moved events to its page and CSS :hover never fires.
// An NSTrackingArea with NSTrackingActiveAlways reports enter/exit/move
// regardless of which app is active; the owner forwards them to the island
// page as `island-hover` and `island-edge` (edge changes only). Nothing fires
// while the pointer is elsewhere. With click-through on, the panel ignores the
// mouse and the area stays silent.

#[cfg(target_os = "macos")]
static HOVER_APP: std::sync::OnceLock<AppHandle> = std::sync::OnceLock::new();

/// Edge the pointer is near (-1 left, 1 right, 0 neither), so the island's
/// resize handles appear only there. Emitted on change only.
#[cfg(target_os = "macos")]
static HOVER_EDGE: std::sync::atomic::AtomicI8 = std::sync::atomic::AtomicI8::new(0);

/// How close to a side edge (points) counts as "near" for the resize handles.
#[cfg(target_os = "macos")]
const EDGE_ZONE_PT: f64 = 20.0;

#[cfg(target_os = "macos")]
fn emit_island_edge(edge: i8) {
    use std::sync::atomic::Ordering;
    use tauri::Emitter;
    if HOVER_EDGE.swap(edge, Ordering::AcqRel) == edge {
        return;
    }
    if let Some(app) = HOVER_APP.get() {
        let _ = app.emit_to(
            tauri::EventTarget::webview_window("island"),
            "island-edge",
            edge,
        );
    }
}

#[cfg(target_os = "macos")]
fn emit_island_hover(hovered: bool) {
    use tauri::Emitter;
    if let Some(app) = HOVER_APP.get() {
        let _ = app.emit_to(
            tauri::EventTarget::webview_window("island"),
            "island-hover",
            hovered,
        );
    }
}

/// Which side edge a mouse event is near, or `None` without a window.
#[cfg(target_os = "macos")]
fn edge_of(event: &NSEvent, mtm: MainThreadMarker) -> Option<i8> {
    let window = event.window(mtm)?;
    let point = event.locationInWindow();
    let width = window.frame().size.width;
    Some(if point.x <= EDGE_ZONE_PT {
        -1
    } else if point.x >= width - EDGE_ZONE_PT {
        1
    } else {
        0
    })
}

#[cfg(target_os = "macos")]
define_class!(
    /// Receives hover and accessibility callbacks. The content view retains
    /// it without replacing Tauri's window delegate.
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[name = "LyraIslandHoverOwner"]
    struct HoverOwner;

    unsafe impl NSObjectProtocol for HoverOwner {}

    impl HoverOwner {
        #[unsafe(method(mouseEntered:))]
        fn mouse_entered(&self, _event: &NSEvent) {
            emit_island_hover(true);
        }

        #[unsafe(method(mouseExited:))]
        fn mouse_exited(&self, _event: &NSEvent) {
            emit_island_edge(0);
            emit_island_hover(false);
        }

        #[unsafe(method(mouseMoved:))]
        fn mouse_moved(&self, event: &NSEvent) {
            if let Some(edge) = edge_of(event, self.mtm()) {
                emit_island_edge(edge);
            }
        }

        #[unsafe(method(accessibilityDisplayOptionsChanged:))]
        fn accessibility_display_options_changed(&self, _notification: &NSNotification) {
            if let Some(app) = HOVER_APP.get() {
                let battery_saver = app.state::<crate::AppState>().runtime.lock()
                    .map(|rt| rt.settings().behavior.battery_saver)
                    .unwrap_or(false);
                set_island_glass(app, !battery_saver);
            }
        }
    }
);

/// Whether the pointer is over the island right now. The island page asks
/// this a few times a second while it believes it is hovered, so its hover
/// effects reverse even if an exit event never arrives.
#[cfg(target_os = "macos")]
pub fn island_pointer_inside(app: &AppHandle) -> bool {
    let Some(window) = app.get_webview_window("island") else {
        return false;
    };
    // Called from a synchronous command, which Tauri runs on the main thread.
    let Some(ns_window) = ns_window(&window) else {
        return false;
    };
    let location = NSEvent::mouseLocation();
    let frame = ns_window.frame();
    location.x >= frame.origin.x
        && location.x <= frame.origin.x + frame.size.width
        && location.y >= frame.origin.y
        && location.y <= frame.origin.y + frame.size.height
}

#[cfg(target_os = "macos")]
fn track_island_hover(app: &AppHandle, window: &tauri::WebviewWindow) {
    // tauri-nspanel's hover handler replaces the window delegate instead of
    // forwarding to Tao. Keep this tracking owner so onMoved/onResized (and
    // docking/position persistence) continue to reach Tauri.
    static OWNER_KEY: u8 = 0;
    let _ = HOVER_APP.set(app.clone());
    let window_clone = window.clone();
    let _ = window.run_on_main_thread(move || {
        let Some(mtm) = MainThreadMarker::new() else {
            return;
        };
        let Some(content_view) = ns_window(&window_clone).and_then(|w| w.contentView()) else {
            return;
        };
        let view_ptr = Retained::as_ptr(&content_view) as *mut AnyObject;
        let key = std::ptr::from_ref(&OWNER_KEY).cast();
        // SAFETY: both pointers remain valid on the main thread. Avoid adding
        // duplicate tracking areas if panel setup is called again.
        if !unsafe { objc_getAssociatedObject(view_ptr, key) }.is_null() {
            return;
        }
        // SAFETY: `init` is NSObject's designated initialiser.
        let owner: Retained<HoverOwner> = unsafe { msg_send![HoverOwner::alloc(mtm), init] };
        // Moves are delivered only while the pointer is over the island and
        // only emit on edge changes.
        let options = NSTrackingAreaOptions::MouseEnteredAndExited
            | NSTrackingAreaOptions::MouseMoved
            | NSTrackingAreaOptions::ActiveAlways
            | NSTrackingAreaOptions::InVisibleRect;
        let owner_object: &AnyObject = &owner;
        // SAFETY: the owner implements the callbacks these options request.
        let area = unsafe {
            NSTrackingArea::initWithRect_options_owner_userInfo(
                NSTrackingArea::alloc(),
                NSRect::ZERO,
                options,
                Some(owner_object),
                None,
            )
        };
        // SAFETY: the view retains the owner for its lifetime. The selector
        // observer is automatically removed when the owner is deallocated.
        unsafe {
            objc_setAssociatedObject(
                view_ptr,
                key,
                Retained::as_ptr(&owner) as *mut AnyObject,
                OBJC_ASSOCIATION_RETAIN_NONATOMIC,
            );
            NSWorkspace::sharedWorkspace()
                .notificationCenter()
                .addObserver_selector_name_object(
                    owner_object,
                    sel!(accessibilityDisplayOptionsChanged:),
                    Some(NSWorkspaceAccessibilityDisplayOptionsDidChangeNotification),
                    None,
                );
        }
        content_view.addTrackingArea(&area);
    });
}

// ── Island glass ───────────────────────────────────────────────────────────────
//
// The island's backdrop is native: Liquid Glass on macOS 26+, the HUD material
// before that (Tauri falls back by itself). A CSS backdrop-filter can't do
// this: in a transparent webview it blurs only the page, never the desktop
// behind the window.

/// Corner radius of the glass; matches `.floating-panel` in island.css.
#[cfg(target_os = "macos")]
const ISLAND_GLASS_RADIUS: f64 = 20.0;

/// Whether the island sits flush with the top of its screen. Docked, it has
/// square top corners, so its glass reaches one corner radius above the window
/// and the window edge cuts those corners off.
#[cfg(target_os = "macos")]
static ISLAND_DOCKED: AtomicBool = AtomicBool::new(false);

/// The island is always styled dark, so its glass should be too. Set on this
/// window only: Tauri's `set_theme` changes the appearance of the whole app.
#[cfg(target_os = "macos")]
fn set_dark_appearance(window: &tauri::WebviewWindow) {
    let window_clone = window.clone();
    let _ = window.run_on_main_thread(move || {
        let Some(ns_window) = ns_window(&window_clone) else {
            return;
        };
        // SAFETY: an AppKit constant, valid for the life of the process.
        let dark = NSAppearance::appearanceNamed(unsafe { NSAppearanceNameDarkAqua });
        ns_window.setAppearance(dark.as_deref());
    });
}

/// Put the glass behind the island, or take it away (battery saver).
#[cfg(target_os = "macos")]
pub fn set_island_glass(app: &AppHandle, enabled: bool) {
    use tauri::window::{Effect, EffectState, EffectsBuilder};
    let Some(window) = app.get_webview_window("island") else {
        return;
    };
    let reduced_transparency =
        NSWorkspace::sharedWorkspace().accessibilityDisplayShouldReduceTransparency();
    let effects = (enabled && !reduced_transparency).then(|| {
        EffectsBuilder::new()
            .effects([Effect::LiquidGlassRegular, Effect::HudWindow])
            // The panel never becomes key; keep the material lit regardless.
            .state(EffectState::Active)
            .radius(ISLAND_GLASS_RADIUS)
            .build()
    });
    // Both run in order on the main thread, so the glass exists by the fit.
    if let Err(error) = window.set_effects(effects) {
        log::warn!("Could not update Marquee glass: {error}");
    }
    let window_clone = window.clone();
    let _ = window.run_on_main_thread(move || {
        if let Some(ns_window) = ns_window(&window_clone) {
            fit_island_glass(&ns_window, ISLAND_DOCKED.load(Ordering::Acquire));
            sync_island_glass_state(&window_clone);
        }
    });
}

/// Publish the actual native effect state after setup and window readiness.
#[cfg(target_os = "macos")]
pub fn sync_island_glass_state(window: &tauri::WebviewWindow) {
    let has_glass = ns_window(window)
        .and_then(|w| w.contentView())
        .is_some_and(|view| {
            view.subviews().iter().any(|child| {
                [c"NSGlassEffectView", c"NSVisualEffectView"]
                    .into_iter()
                    .filter_map(AnyClass::get)
                    .any(|class| child.isKindOfClass(class))
            })
        });
    let reduced_transparency =
        NSWorkspace::sharedWorkspace().accessibilityDisplayShouldReduceTransparency();
    let _ = window.eval(format!(
        "document.documentElement.dataset.nativeGlass = '{has_glass}'; document.documentElement.dataset.reducedTransparency = '{reduced_transparency}';"
    ));
}

/// Size the glass view to the island, reaching above it while docked. Call on
/// the main thread.
#[cfg(target_os = "macos")]
fn fit_island_glass(ns_window: &NSWindow, docked: bool) {
    let Some(content_view) = ns_window.contentView() else {
        return;
    };
    let glass_classes: Vec<&AnyClass> = [c"NSGlassEffectView", c"NSVisualEffectView"]
        .into_iter()
        .filter_map(AnyClass::get)
        .collect();
    let lift = if docked { ISLAND_GLASS_RADIUS } else { 0.0 };
    let mut frame = content_view.bounds();
    frame.size.height += lift;
    if content_view.isFlipped() {
        frame.origin.y -= lift;
    }
    for view in content_view.subviews().iter() {
        if glass_classes.iter().any(|class| view.isKindOfClass(class)) {
            view.setFrame(frame);
        }
    }
}

#[cfg(not(target_os = "macos"))]
pub fn init_overlay_panels(_app: &AppHandle, _island_glass: bool) -> tauri::Result<()> {
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn set_island_glass(_app: &AppHandle, _enabled: bool) {}

#[cfg(not(target_os = "macos"))]
pub fn sync_island_glass_state(_window: &tauri::WebviewWindow) {}

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

/// The notch of the display `window` is on, if it has one. Call on the main
/// thread.
#[cfg(target_os = "macos")]
pub fn display_notch(window: &tauri::WebviewWindow) -> Option<crate::island_size::Notch> {
    let screen = ns_window(window)?.screen()?;
    // The safe area and the areas beside the notch arrived in macOS 12.
    if !screen.respondsToSelector(sel!(safeAreaInsets)) {
        return None;
    }
    let height = screen.safeAreaInsets().top;
    let beside_left = screen.auxiliaryTopLeftArea().size.width;
    let beside_right = screen.auxiliaryTopRightArea().size.width;
    let notch = crate::island_size::Notch {
        left: beside_left,
        right: screen.frame().size.width - beside_right,
        height,
    };
    (height > 0.0 && beside_left > 0.0 && notch.right > notch.left).then_some(notch)
}

#[cfg(not(target_os = "macos"))]
pub fn display_notch(_window: &tauri::WebviewWindow) -> Option<crate::island_size::Notch> {
    None
}

#[cfg(target_os = "macos")]
pub fn set_island_size(app: &AppHandle, width: u32, height: u32) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window("island") {
        window.set_size(tauri::Size::Logical(tauri::LogicalSize::new(
            width as f64,
            height as f64,
        )))?;
    }
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn set_island_size(app: &AppHandle, width: u32, height: u32) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window("island") {
        let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize::new(
            width as f64,
            height as f64,
        )));
    }
    Ok(())
}
