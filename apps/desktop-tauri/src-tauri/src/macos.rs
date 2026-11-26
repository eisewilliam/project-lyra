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
    NSAnimatablePropertyContainer, NSAnimationContext, NSAppearance, NSAppearanceCustomization,
    NSAppearanceNameDarkAqua, NSApplication, NSApplicationActivationPolicy, NSEvent, NSScreen,
    NSTrackingArea, NSTrackingAreaOptions, NSWindow, NSWindowAnimationBehavior,
    NSWindowCollectionBehavior, NSWindowStyleMask, NSWorkspace,
    NSWorkspaceAccessibilityDisplayOptionsDidChangeNotification,
};
#[cfg(target_os = "macos")]
use objc2_foundation::{ns_string, NSNotification, NSObject, NSObjectProtocol, NSPoint, NSRect};
#[cfg(target_os = "macos")]
use objc2_quartz_core::CAMediaTimingFunction;
#[cfg(target_os = "macos")]
use std::sync::atomic::{AtomicU64, AtomicU8, Ordering};
#[cfg(target_os = "macos")]
use std::sync::Mutex;
#[cfg(target_os = "macos")]
use std::time::Duration;
#[cfg(target_os = "macos")]
use tauri_nspanel::{ManagerExt, WebviewWindowExt};

// NSWindowLevel constants (AppKit)
#[cfg(target_os = "macos")]
const NS_FLOATING_WINDOW_LEVEL: i64 = 3;
// kCGUtilityWindowLevel, one below the Dock (20): the marquee's level
// anywhere below the menu bar and clear of a pinned Dock. Above every app's
// windows, including other floating panels, but under the Dock, menu bar and
// menus, so an auto-hidden Dock or menu bar slides out over it.
#[cfg(target_os = "macos")]
const UTILITY_WINDOW_LEVEL: i64 = 19;
// One above the Dock (20): the marquee's level when attached to or dragged
// past a visible, pinned Dock on the bottom, left, or right edge.
#[cfg(target_os = "macos")]
const ABOVE_DOCK_LEVEL: i64 = 21;
// One above the status items (NSStatusWindowLevel, 25): the marquee's level
// while it overlaps the menu bar, docked against the top edge or being
// dragged there. Above the menu bar and its status items, still under menus.
#[cfg(target_os = "macos")]
const ABOVE_MENU_BAR_LEVEL: i64 = 26;

#[cfg(target_os = "macos")]
const LEVEL_UTILITY: u8 = 0;
#[cfg(target_os = "macos")]
const LEVEL_ABOVE_DOCK: u8 = 1;
#[cfg(target_os = "macos")]
const LEVEL_ABOVE_MENU_BAR: u8 = 2;

/// The NSPanel subclass the marquee and karaoke windows become. The macro
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
        "marquee" => match MARQUEE_LEVEL.load(Ordering::Acquire) {
            LEVEL_ABOVE_MENU_BAR => ABOVE_MENU_BAR_LEVEL,
            LEVEL_ABOVE_DOCK => ABOVE_DOCK_LEVEL,
            _ => UTILITY_WINDOW_LEVEL,
        },
        _ => NS_FLOATING_WINDOW_LEVEL,
    }
}

#[cfg(target_os = "macos")]
fn set_marquee_level(app: &AppHandle, level: u8) {
    if MARQUEE_LEVEL.swap(level, Ordering::AcqRel) != level {
        if let Ok(panel) = app.get_webview_panel("marquee") {
            panel.set_level(overlay_level("marquee"));
        }
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
#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFRunLoopGetMain() -> *mut std::ffi::c_void;
    fn CFRunLoopAddCommonMode(rl: *mut std::ffi::c_void, mode: *const std::ffi::c_void);
}

/// CoreDock spins the private `dockmsg-mode` run-loop mode while minimizing or
/// restoring a window. Registering it as a common mode keeps Tao's event/IPC
/// observers and WebKit's timers responsive on other windows during the Dock
/// Genie/Scale animation.
#[cfg(target_os = "macos")]
fn enable_runloop_during_dock_animation() {
    let mode: &objc2_foundation::NSString = ns_string!("dockmsg-mode");
    // SAFETY: `CFRunLoopGetMain()` returns the process main run loop, and
    // `ns_string!` yields a valid toll-free-bridged `CFStringRef`.
    unsafe {
        let main_rl = CFRunLoopGetMain();
        if !main_rl.is_null() {
            CFRunLoopAddCommonMode(main_rl, std::ptr::from_ref(mode).cast());
        }
    }
}

#[cfg(target_os = "macos")]
fn set_can_hide_false(window: &tauri::WebviewWindow) {
    let apply = |win: &tauri::WebviewWindow| {
        if let Some(native) = ns_window(win) {
            native.setCanHide(false);
        }
    };
    if MainThreadMarker::new().is_some() {
        apply(window);
    } else {
        let win = window.clone();
        let _ = window.run_on_main_thread(move || apply(&win));
    }
}

#[cfg(target_os = "macos")]
fn disable_implicit_window_animation(window: &tauri::WebviewWindow) {
    let apply = |win: &tauri::WebviewWindow| {
        if let Some(native) = ns_window(win) {
            native.setAnimationBehavior(NSWindowAnimationBehavior::None);
        }
    };
    if MainThreadMarker::new().is_some() {
        apply(window);
    } else {
        let win = window.clone();
        let _ = window.run_on_main_thread(move || apply(&win));
    }
}

#[cfg(target_os = "macos")]
pub fn init_overlay_panels(app: &AppHandle, marquee_glass: bool) -> tauri::Result<()> {
    enable_runloop_during_dock_animation();
    if let Some(window) = app.get_webview_window("main") {
        disable_implicit_window_animation(&window);
    }
    if let Some(window) = app.get_webview_window("marquee") {
        let _ = window.to_panel::<LyraOverlayPanel>()?;
        set_can_hide_false(&window);
        unconstrain_from_screen(&window);
        keep_glass_active(&window);
        track_marquee_hover(app, &window);
        set_dark_appearance(&window);
        set_marquee_glass(app, marquee_glass);
    }
    if let Some(window) = app.get_webview_window("karaoke") {
        let _ = window.to_panel::<LyraOverlayPanel>()?;
        set_can_hide_false(&window);
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
/// veil, and the marquee is a non-activating panel that is almost never key.
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
    if !matches!(label, "marquee" | "karaoke") {
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

            if window_clone.label() == "marquee" {
                let docked = top_offset_points.abs() < 0.5;
                let bleed = crate::marquee_size::GlassBleed {
                    top: if docked { MARQUEE_GLASS_RADIUS } else { 0.0 },
                    ..crate::marquee_size::GlassBleed::ZERO
                };
                if set_marquee_bleed(bleed) {
                    fit_marquee_glass(&ns_window, bleed);
                }
                // Over the menu bar (or, with it hidden, docked under the
                // notch) the marquee rises above it; anywhere else it sits
                // under the Dock and menu bar again.
                let visible = screen.visibleFrame();
                let menu_bar = screen_top - (visible.origin.y + visible.size.height);
                let level = if top_offset_points < menu_bar.max(0.5) {
                    LEVEL_ABOVE_MENU_BAR
                } else {
                    LEVEL_UTILITY
                };
                set_marquee_level(window_clone.app_handle(), level);
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
    if !matches!(label, "marquee" | "karaoke") {
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

    if label == "marquee" {
        panel.set_becomes_key_only_if_needed(true);
    }

    if visible {
        panel.show();
    } else {
        panel.hide();
    }

    true
}

// ── Marquee hover ───────────────────────────────────────────────────────────────
//
// The marquee is a non-activating panel, so while another app is active WebKit
// may not deliver mouse-moved events to its page and CSS :hover never fires.
// An NSTrackingArea with NSTrackingActiveAlways reports enter/exit/move
// regardless of which app is active; the owner forwards them to the marquee
// page as `marquee-hover` and `marquee-edge` (edge changes only). Nothing fires
// while the pointer is elsewhere. With click-through on, the panel ignores the
// mouse and the area stays silent.

#[cfg(target_os = "macos")]
static HOVER_APP: std::sync::OnceLock<AppHandle> = std::sync::OnceLock::new();

/// Edge the pointer is near (-1 left, 1 right, 0 neither), so the marquee's
/// resize handles appear only there. Emitted on change only.
#[cfg(target_os = "macos")]
static HOVER_EDGE: std::sync::atomic::AtomicI8 = std::sync::atomic::AtomicI8::new(0);

/// How close to a side edge (points) counts as "near" for the resize handles.
#[cfg(target_os = "macos")]
const EDGE_ZONE_PT: f64 = 20.0;

#[cfg(target_os = "macos")]
fn emit_marquee_edge(edge: i8) {
    use std::sync::atomic::Ordering;
    use tauri::Emitter;
    if HOVER_EDGE.swap(edge, Ordering::AcqRel) == edge {
        return;
    }
    if let Some(app) = HOVER_APP.get() {
        let _ = app.emit_to(
            tauri::EventTarget::webview_window("marquee"),
            "marquee-edge",
            edge,
        );
    }
}

#[cfg(target_os = "macos")]
fn emit_marquee_hover(hovered: bool) {
    use tauri::Emitter;
    if let Some(app) = HOVER_APP.get() {
        let _ = app.emit_to(
            tauri::EventTarget::webview_window("marquee"),
            "marquee-hover",
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
    #[name = "LyraMarqueeHoverOwner"]
    struct HoverOwner;

    unsafe impl NSObjectProtocol for HoverOwner {}

    impl HoverOwner {
        #[unsafe(method(mouseEntered:))]
        fn mouse_entered(&self, _event: &NSEvent) {
            emit_marquee_hover(true);
        }

        #[unsafe(method(mouseExited:))]
        fn mouse_exited(&self, _event: &NSEvent) {
            emit_marquee_edge(0);
            emit_marquee_hover(false);
        }

        #[unsafe(method(mouseMoved:))]
        fn mouse_moved(&self, event: &NSEvent) {
            if let Some(edge) = edge_of(event, self.mtm()) {
                emit_marquee_edge(edge);
            }
        }

        #[unsafe(method(accessibilityDisplayOptionsChanged:))]
        fn accessibility_display_options_changed(&self, _notification: &NSNotification) {
            if let Some(app) = HOVER_APP.get() {
                let battery_saver = app.state::<crate::AppState>().runtime.lock()
                    .map(|rt| rt.settings().behavior.battery_saver)
                    .unwrap_or(false);
                set_marquee_glass(app, !battery_saver);
            }
        }
    }
);

/// Whether the pointer is over the marquee right now. The marquee page asks
/// this a few times a second while it believes it is hovered, so its hover
/// effects reverse even if an exit event never arrives.
#[cfg(target_os = "macos")]
pub fn marquee_pointer_inside(app: &AppHandle) -> bool {
    let Some(window) = app.get_webview_window("marquee") else {
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
fn track_marquee_hover(app: &AppHandle, window: &tauri::WebviewWindow) {
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
        // Moves are delivered only while the pointer is over the marquee and
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

// ── Marquee glass ───────────────────────────────────────────────────────────────
//
// The marquee's backdrop is native: Liquid Glass on macOS 26+, the HUD material
// before that (Tauri falls back by itself). A CSS backdrop-filter can't do
// this: in a transparent webview it blurs only the page, never the desktop
// behind the window.

/// Corner radius of the glass; matches `.floating-panel` in marquee.css.
#[cfg(target_os = "macos")]
pub(crate) const MARQUEE_GLASS_RADIUS: f64 = 20.0;

/// Current 4-edge glass bleed in points. Docked edges bleed past the window
/// edge so the OS window clips those rounded corners square; peeling reduces
/// the bleed smoothly in lockstep with the CSS border radius.
#[cfg(target_os = "macos")]
static MARQUEE_BLEED: Mutex<crate::marquee_size::GlassBleed> =
    Mutex::new(crate::marquee_size::GlassBleed::ZERO);

/// Current macOS overlay level bucket for the marquee.
#[cfg(target_os = "macos")]
static MARQUEE_LEVEL: AtomicU8 = AtomicU8::new(LEVEL_UTILITY);

#[cfg(target_os = "macos")]
fn current_bleed() -> crate::marquee_size::GlassBleed {
    *MARQUEE_BLEED.lock().unwrap_or_else(|e| e.into_inner())
}

#[cfg(target_os = "macos")]
fn set_marquee_bleed(bleed: crate::marquee_size::GlassBleed) -> bool {
    let mut slot = MARQUEE_BLEED.lock().unwrap_or_else(|e| e.into_inner());
    if *slot == bleed {
        return false;
    }
    *slot = bleed;
    true
}

/// The marquee is always styled dark, so its glass should be too. Set on this
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

/// Put the glass behind the marquee, or take it away (battery saver).
#[cfg(target_os = "macos")]
pub fn set_marquee_glass(app: &AppHandle, enabled: bool) {
    use tauri::window::{Effect, EffectState, EffectsBuilder};
    let Some(window) = app.get_webview_window("marquee") else {
        return;
    };
    let reduced_transparency =
        NSWorkspace::sharedWorkspace().accessibilityDisplayShouldReduceTransparency();
    let effects = (enabled && !reduced_transparency).then(|| {
        EffectsBuilder::new()
            .effects([Effect::LiquidGlassRegular, Effect::HudWindow])
            // The panel never becomes key; keep the material lit regardless.
            .state(EffectState::Active)
            .radius(MARQUEE_GLASS_RADIUS)
            .build()
    });
    // Both run in order on the main thread, so the glass exists by the fit.
    if let Err(error) = window.set_effects(effects) {
        log::warn!("Could not update Marquee glass: {error}");
    }
    let window_clone = window.clone();
    let _ = window.run_on_main_thread(move || {
        if let Some(ns_window) = ns_window(&window_clone) {
            fit_marquee_glass(&ns_window, current_bleed());
            sync_marquee_glass_state(&window_clone);
        }
    });
}

/// Publish the actual native effect state after setup and window readiness.
#[cfg(target_os = "macos")]
pub fn sync_marquee_glass_state(window: &tauri::WebviewWindow) {
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

/// Size the glass view to the marquee, bleeding past any docked edges so the
/// window clips those corners square. Call on the main thread.
#[cfg(target_os = "macos")]
fn fit_marquee_glass(ns_window: &NSWindow, bleed: crate::marquee_size::GlassBleed) {
    let Some(content_view) = ns_window.contentView() else {
        return;
    };
    let glass_classes: Vec<&AnyClass> = [c"NSGlassEffectView", c"NSVisualEffectView"]
        .into_iter()
        .filter_map(AnyClass::get)
        .collect();
    let flipped = content_view.isFlipped();
    let mut frame = content_view.bounds();
    frame.origin.x -= bleed.left;
    frame.size.width += bleed.left + bleed.right;
    frame.size.height += bleed.top + bleed.bottom;
    if flipped {
        frame.origin.y -= bleed.top;
    } else {
        frame.origin.y -= bleed.bottom;
    }
    for view in content_view.subviews().iter() {
        if glass_classes.iter().any(|class| view.isKindOfClass(class)) {
            view.setFrame(frame);
        }
    }
}

// ── Settings sidebar glass ─────────────────────────────────────────────────────
//
// On macOS 26 System Settings floats its sidebar as a pane of Liquid Glass,
// inset from the window's edges. The settings page says where its sidebar
// sits; the glass goes there behind the webview, above the window's sidebar
// material, and the page leaves that area clear so the glass shows through.

/// Put Liquid Glass behind the settings sidebar, move it, or take it away
/// (`None`). Returns whether glass is showing: never before macOS 26 or with
/// Reduce Transparency, where the window keeps its sidebar material alone.
/// Called from a synchronous command, which Tauri runs on the main thread.
#[cfg(target_os = "macos")]
pub fn set_settings_sidebar_glass(
    app: &AppHandle,
    glass: Option<crate::commands::SidebarGlass>,
) -> bool {
    use objc2_app_kit::{
        NSGlassEffectView, NSTitlebarSeparatorStyle, NSToolbar, NSWindowOrderingMode,
        NSWindowToolbarStyle,
    };
    use objc2_foundation::NSSize;

    let Some(mtm) = MainThreadMarker::new() else {
        return false;
    };
    let Some(window) = app
        .get_webview_window("settings")
        .and_then(|window| ns_window(&window))
    else {
        return false;
    };
    let Some(content_view) = window.contentView() else {
        return false;
    };
    // The class arrived in macOS 26; naming it by type before then aborts.
    let Some(glass_class) = AnyClass::get(c"NSGlassEffectView") else {
        return false;
    };
    let existing = content_view
        .subviews()
        .iter()
        .find(|view| view.isKindOfClass(glass_class));
    let reduced_transparency =
        NSWorkspace::sharedWorkspace().accessibilityDisplayShouldReduceTransparency();
    let Some(glass) = glass.filter(|_| !reduced_transparency) else {
        if let Some(view) = existing {
            view.removeFromSuperview();
        }
        window.setToolbar(None);
        return false;
    };

    // An empty unified toolbar is what gives System Settings its look around
    // the glass: macOS 26 rounds a window with a toolbar more, so the glass's
    // corners follow the window's, and centres the window buttons in a taller
    // bar, inside the glass rather than on its edge.
    if window.toolbar().is_none() {
        window.setToolbar(Some(&NSToolbar::new(mtm)));
        window.setToolbarStyle(NSWindowToolbarStyle::Unified);
        window.setTitlebarSeparatorStyle(NSTitlebarSeparatorStyle::None);
    }

    let bounds = content_view.bounds();
    let y = if content_view.isFlipped() {
        glass.y
    } else {
        bounds.size.height - glass.y - glass.height
    };
    let frame = NSRect::new(
        NSPoint::new(glass.x, y),
        NSSize::new(glass.width, glass.height),
    );
    let view = match existing.and_then(|view| view.downcast::<NSGlassEffectView>().ok()) {
        Some(view) => view,
        None => {
            let view = NSGlassEffectView::initWithFrame(mtm.alloc(), frame);
            // Above the window's sidebar material, so the glass bends the
            // desktop it shows, and below the webview.
            let material = AnyClass::get(c"NSVisualEffectView").and_then(|class| {
                content_view
                    .subviews()
                    .iter()
                    .find(|view| view.isKindOfClass(class))
            });
            match material {
                Some(material) => content_view.addSubview_positioned_relativeTo(
                    &view,
                    NSWindowOrderingMode::Above,
                    Some(&*material),
                ),
                None => content_view.addSubview_positioned_relativeTo(
                    &view,
                    NSWindowOrderingMode::Below,
                    None,
                ),
            }
            view
        }
    };
    view.setFrame(frame);
    view.setCornerRadius(glass.radius);
    true
}

#[cfg(not(target_os = "macos"))]
pub fn init_overlay_panels(_app: &AppHandle, _marquee_glass: bool) -> tauri::Result<()> {
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn set_marquee_glass(_app: &AppHandle, _enabled: bool) {}

#[cfg(not(target_os = "macos"))]
pub fn sync_marquee_glass_state(_window: &tauri::WebviewWindow) {}

#[cfg(not(target_os = "macos"))]
pub fn set_overlay_position(app: &AppHandle, label: &str, x: i32, y: i32) -> tauri::Result<()> {
    if !crate::linux::native_wayland() {
        if let Some(window) = app.get_webview_window(label) {
            let _ = window.set_position(tauri::Position::Physical(tauri::PhysicalPosition::new(
                x, y,
            )));
        }
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

// ── Marquee geometry ────────────────────────────────────────────────────────────

#[cfg(target_os = "macos")]
fn notch_for_screen(screen: &NSScreen) -> Option<crate::marquee_size::Notch> {
    if !screen.respondsToSelector(sel!(safeAreaInsets)) {
        return None;
    }
    let height = screen.safeAreaInsets().top;
    let beside_left = screen.auxiliaryTopLeftArea().size.width;
    let beside_right = screen.auxiliaryTopRightArea().size.width;
    let notch = crate::marquee_size::Notch {
        left: beside_left,
        right: screen.frame().size.width - beside_right,
        height,
    };
    (height > 0.0 && beside_left > 0.0 && notch.right > notch.left).then_some(notch)
}

/// The notch of the display `window` is on, if it has one. Call on the main
/// thread.
#[cfg(target_os = "macos")]
pub fn display_notch(window: &tauri::WebviewWindow) -> Option<crate::marquee_size::Notch> {
    let screen = ns_window(window)?.screen()?;
    notch_for_screen(&screen)
}

#[cfg(not(target_os = "macos"))]
pub fn display_notch(_window: &tauri::WebviewWindow) -> Option<crate::marquee_size::Notch> {
    None
}

#[derive(Clone, Copy, Debug)]
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub struct MacScreen {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub work_left: f64,
    pub work_top: f64,
    pub work_right: f64,
    pub work_bottom: f64,
    pub notch: Option<crate::marquee_size::Notch>,
}

#[cfg(target_os = "macos")]
fn primary_screen_height(mtm: MainThreadMarker) -> Option<f64> {
    NSScreen::screens(mtm)
        .iter()
        .next()
        .map(|s| s.frame().size.height)
}

/// All macOS displays in global Y-down logical points. Call on the main thread.
#[cfg(target_os = "macos")]
pub fn macos_screens() -> Vec<MacScreen> {
    let Some(mtm) = MainThreadMarker::new() else {
        return Vec::new();
    };
    let Some(primary_h) = primary_screen_height(mtm) else {
        return Vec::new();
    };
    NSScreen::screens(mtm)
        .iter()
        .map(|screen| {
            let frame = screen.frame();
            let visible = screen.visibleFrame();
            let x = frame.origin.x;
            let y = primary_h - (frame.origin.y + frame.size.height);
            let work_left = visible.origin.x - frame.origin.x;
            let work_top =
                (frame.origin.y + frame.size.height) - (visible.origin.y + visible.size.height);
            MacScreen {
                x,
                y,
                width: frame.size.width,
                height: frame.size.height,
                work_left,
                work_top,
                work_right: work_left + visible.size.width,
                work_bottom: work_top + visible.size.height,
                notch: notch_for_screen(&screen),
            }
        })
        .collect()
}

#[cfg(not(target_os = "macos"))]
pub fn macos_screens() -> Vec<MacScreen> {
    Vec::new()
}

/// Global pointer position in Y-down logical points. Call on the main thread.
#[cfg(target_os = "macos")]
pub fn macos_mouse_location_y_down() -> Option<(f64, f64)> {
    let mtm = MainThreadMarker::new()?;
    let primary_h = primary_screen_height(mtm)?;
    let location = NSEvent::mouseLocation();
    Some((location.x, primary_h - location.y))
}

#[cfg(not(target_os = "macos"))]
pub fn macos_mouse_location_y_down() -> Option<(f64, f64)> {
    None
}

#[cfg(target_os = "macos")]
pub fn macos_pressed_mouse_location_y_down() -> Option<(f64, f64)> {
    if NSEvent::pressedMouseButtons() & 1 == 0 {
        return None;
    }
    macos_mouse_location_y_down()
}

#[cfg(not(target_os = "macos"))]
pub fn macos_pressed_mouse_location_y_down() -> Option<(f64, f64)> {
    None
}

/// Window frame `(x, y, width, height)` in global Y-down logical points.
#[cfg(target_os = "macos")]
pub fn window_frame_global_pt(window: &tauri::WebviewWindow) -> Option<(f64, f64, f64, f64)> {
    let mtm = MainThreadMarker::new()?;
    let primary_h = primary_screen_height(mtm)?;
    let frame = ns_window(window)?.frame();
    Some((
        frame.origin.x,
        primary_h - (frame.origin.y + frame.size.height),
        frame.size.width,
        frame.size.height,
    ))
}

#[cfg(not(target_os = "macos"))]
pub fn window_frame_global_pt(_window: &tauri::WebviewWindow) -> Option<(f64, f64, f64, f64)> {
    None
}

/// Marquee frame `(x, y, width, height)` in global Y-down logical points.
pub fn marquee_frame_global_pt(window: &tauri::WebviewWindow) -> Option<(f64, f64, f64, f64)> {
    window_frame_global_pt(window)
}

#[cfg(target_os = "macos")]
pub fn reduce_motion() -> bool {
    NSWorkspace::sharedWorkspace().accessibilityDisplayShouldReduceMotion()
}

#[cfg(not(target_os = "macos"))]
pub fn reduce_motion() -> bool {
    false
}

#[cfg(target_os = "macos")]
const MAIN_REVEAL_DURATION_SECS: f64 = 0.18;

/// Reveal a hidden, non-minimized main window with a pure GPU alpha fade
/// (no frame change or `NSWindowAnimationBehavior` zoom) so `WKWebView` and the
/// Marquee never stall during the reveal. Must be called on the main thread;
/// returns `false` to fall back to standard show.
#[cfg(target_os = "macos")]
pub fn show_main_window_animated(window: &tauri::WebviewWindow) -> bool {
    let Some(_mtm) = MainThreadMarker::new() else {
        return false;
    };
    let Some(native) = ns_window(window) else {
        return false;
    };
    if native.isMiniaturized() || native.isVisible() {
        return false;
    }

    native.setAnimationBehavior(NSWindowAnimationBehavior::None);
    native.setAlphaValue(0.0);

    let _ = window.show();
    let _ = window.set_focus();

    NSAnimationContext::beginGrouping();
    let ctx = NSAnimationContext::currentContext();
    ctx.setDuration(MAIN_REVEAL_DURATION_SECS);
    let timing = CAMediaTimingFunction::functionWithControlPoints(0.22, 1.0, 0.36, 1.0);
    ctx.setTimingFunction(Some(&timing));
    native.animator().setAlphaValue(1.0);
    NSAnimationContext::endGrouping();

    true
}

#[cfg(not(target_os = "macos"))]
pub fn show_main_window_animated(_window: &tauri::WebviewWindow) -> bool {
    false
}

/// Cancel any in-flight compositor reveal and restore full opacity.
#[cfg(target_os = "macos")]
pub fn reset_main_window_reveal(window: &tauri::WebviewWindow) {
    fn apply(win: &tauri::WebviewWindow) {
        let Some(native) = ns_window(win) else {
            return;
        };
        NSAnimationContext::beginGrouping();
        NSAnimationContext::currentContext().setDuration(0.0);
        native.animator().setAlphaValue(1.0);
        NSAnimationContext::endGrouping();
        native.setAlphaValue(1.0);
    }

    if MainThreadMarker::new().is_some() {
        apply(window);
    } else {
        let win = window.clone();
        let _ = window.run_on_main_thread(move || apply(&win));
    }
}

#[cfg(not(target_os = "macos"))]
pub fn reset_main_window_reveal(_window: &tauri::WebviewWindow) {}

#[cfg(target_os = "macos")]
static DOCK_POLICY_GEN: AtomicU64 = AtomicU64::new(0);
#[cfg(target_os = "macos")]
const DOCK_HIDE_DEBOUNCE: Duration = Duration::from_millis(1000);
#[cfg(target_os = "macos")]
const DOCK_SHOW_AFTER_REVEAL: Duration = Duration::from_millis(220);

#[cfg(target_os = "macos")]
fn apply_dock_policy(app: &AppHandle, visible: bool, expected_gen: u64) {
    if DOCK_POLICY_GEN.load(Ordering::Acquire) != expected_gen {
        return;
    }
    let Some(mtm) = MainThreadMarker::new() else {
        return;
    };
    let ns_app = NSApplication::sharedApplication(mtm);
    let target = if visible {
        NSApplicationActivationPolicy::Regular
    } else {
        NSApplicationActivationPolicy::Accessory
    };
    if ns_app.activationPolicy() == target {
        return;
    }
    if !visible {
        for label in ["marquee", "karaoke"] {
            if let Some(native) = app
                .get_webview_window(label)
                .and_then(|win| ns_window(&win))
            {
                native.setCanHide(false);
            }
        }
    }
    ns_app.setActivationPolicy(target);
    if visible
        && app
            .get_webview_window("main")
            .is_some_and(|w| w.is_visible().unwrap_or(false))
    {
        #[allow(deprecated)]
        ns_app.activateIgnoringOtherApps(true);
    }
}

/// Update Dock presence on macOS using `NSApplication::setActivationPolicy`,
/// skipping redundant switches and optionally deferring past a transition so
/// Dock/WindowServer IPC never stalls open/close animations or the Marquee.
#[cfg(target_os = "macos")]
pub fn sync_dock_visibility(app: &AppHandle, visible: bool, defer: bool) {
    let gen = DOCK_POLICY_GEN.fetch_add(1, Ordering::AcqRel) + 1;
    let target = if visible {
        NSApplicationActivationPolicy::Regular
    } else {
        NSApplicationActivationPolicy::Accessory
    };
    if let Some(mtm) = MainThreadMarker::new() {
        if NSApplication::sharedApplication(mtm).activationPolicy() == target {
            return;
        }
    }
    if !defer {
        if MainThreadMarker::new().is_some() {
            apply_dock_policy(app, visible, gen);
        } else {
            let handle = app.clone();
            let _ = app.run_on_main_thread(move || apply_dock_policy(&handle, visible, gen));
        }
        return;
    }

    let delay = if visible {
        DOCK_SHOW_AFTER_REVEAL
    } else {
        DOCK_HIDE_DEBOUNCE
    };
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(delay).await;
        if DOCK_POLICY_GEN.load(Ordering::Acquire) != gen {
            return;
        }
        let main_handle = handle.clone();
        let _ = handle.run_on_main_thread(move || apply_dock_policy(&main_handle, visible, gen));
    });
}

#[cfg(not(target_os = "macos"))]
pub fn sync_dock_visibility(_app: &AppHandle, _visible: bool, _defer: bool) {}

/// Atomically apply Marquee frame, 4-edge glass bleed, and window level.
/// On macOS this computes the unclamped AppKit `NSRect` directly and calls
/// `setFrame_display` once so dragging/docking near the menu bar or Dock
/// never flickers. Call on the main thread.
#[allow(clippy::too_many_arguments)]
pub fn apply_marquee_frame(
    app: &AppHandle,
    window: &tauri::WebviewWindow,
    screen_origin_pt: (f64, f64),
    local_origin_pt: (f64, f64),
    phys_origin: (i32, i32),
    size_pt: (f64, f64),
    bleed: crate::marquee_size::GlassBleed,
    dock: crate::marquee_size::DockEdges,
    bounds: crate::marquee_size::DisplayBounds,
) -> tauri::Result<()> {
    #[cfg(target_os = "macos")]
    {
        let _ = phys_origin;
        if let (Some(mtm), Some(native)) = (MainThreadMarker::new(), ns_window(window)) {
            if let Some(primary_h) = primary_screen_height(mtm) {
                let global_x = screen_origin_pt.0 + local_origin_pt.0;
                let global_y = screen_origin_pt.1 + local_origin_pt.1;
                let ns_y = primary_h - (global_y + size_pt.1);
                let next = NSRect::new(
                    NSPoint::new(global_x, ns_y),
                    objc2_foundation::NSSize::new(size_pt.0, size_pt.1),
                );
                let old = native.frame();
                let origin_changed = (old.origin.x - next.origin.x).abs() > 0.05
                    || (old.origin.y - next.origin.y).abs() > 0.05;
                let size_changed = (old.size.width - next.size.width).abs() > 0.05
                    || (old.size.height - next.size.height).abs() > 0.05;
                let bleed_changed = set_marquee_bleed(bleed);
                if size_changed {
                    native.setFrame_display(next, false);
                } else if origin_changed {
                    native.setFrameOrigin(next.origin);
                }
                if size_changed || bleed_changed {
                    fit_marquee_glass(&native, bleed);
                }

                let menu_bar_inset = bounds.work_safe.top;
                let dock_bottom_inset = (bounds.height - bounds.work_safe.bottom).max(0.0);
                let dock_left_inset = bounds.work_safe.left;
                let dock_right_inset = (bounds.width - bounds.work_safe.right).max(0.0);
                let over_menu_bar = dock.top || local_origin_pt.1 < menu_bar_inset.max(0.5);
                let over_visible_dock = (dock_bottom_inset >= 16.0
                    && (dock.bottom || local_origin_pt.1 + size_pt.1 > bounds.work_safe.bottom + 0.5))
                    || (dock_left_inset >= 16.0
                        && (dock.left || local_origin_pt.0 < bounds.work_safe.left - 0.5))
                    || (dock_right_inset >= 16.0
                        && (dock.right || local_origin_pt.0 + size_pt.0 > bounds.work_safe.right + 0.5));
                let level = if over_menu_bar {
                    LEVEL_ABOVE_MENU_BAR
                } else if over_visible_dock {
                    LEVEL_ABOVE_DOCK
                } else {
                    LEVEL_UTILITY
                };
                set_marquee_level(app, level);
                return Ok(());
            }
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, screen_origin_pt, local_origin_pt, bleed);
        let sf = window.scale_factor().unwrap_or(1.0).max(0.5);
        let cur_size = window.outer_size().ok().map(|s| (f64::from(s.width) / sf, f64::from(s.height) / sf));
        if cur_size.is_none_or(|(w, h)| (w - size_pt.0).abs() >= 0.5 || (h - size_pt.1).abs() >= 0.5) {
            window.set_size(tauri::LogicalSize::new(size_pt.0, size_pt.1))?;
        }
        if !crate::linux::native_wayland() {
            window.set_position(tauri::PhysicalPosition::new(phys_origin.0, phys_origin.1))?;
        }
        #[cfg(target_os = "windows")]
        {
            let over_taskbar = (dock.top && bounds.work_safe.top > 0.5)
                || (dock.bottom && bounds.height - bounds.work_safe.bottom > 0.5)
                || (dock.left && bounds.work_safe.left > 0.5)
                || (dock.right && bounds.width - bounds.work_safe.right > 0.5);
            if over_taskbar {
                let _ = window.set_always_on_top(true);
            }
        }
        #[cfg(not(target_os = "windows"))]
        let _ = (dock, bounds);
    }

    Ok(())
}

pub fn marquee_resize_pointer_x() -> Option<f64> {
    #[cfg(target_os = "macos")]
    if NSEvent::pressedMouseButtons() & 1 != 0 {
        return Some(NSEvent::mouseLocation().x);
    }
    None
}

pub fn resize_marquee_window(
    window: &tauri::WebviewWindow,
    width: u32,
    height: u32,
    position: Option<(i32, i32)>,
    anchor_bottom: bool,
) -> tauri::Result<()> {
    #[cfg(target_os = "macos")]
    if let Some(native) = ns_window(window) {
        let old = native.frame();
        let mut x = old.origin.x;
        if let Some((new_x, _)) = position {
            let current_x = window.outer_position()?.x;
            x += (f64::from(new_x) - f64::from(current_x)) / window.scale_factor()?;
        }
        let size = objc2_foundation::NSSize::new(f64::from(width), f64::from(height));
        let y = if anchor_bottom {
            old.origin.y
        } else {
            old.origin.y + old.size.height - size.height
        };
        let origin = NSPoint::new(x, y);
        let next = NSRect::new(origin, size);
        if next != old {
            native.setFrame_display(next, false);
            fit_marquee_glass(&native, current_bleed());
        }
        return Ok(());
    }

    window.set_size(tauri::LogicalSize::new(width, height))?;
    if let Some((x, y)) = position {
        if !crate::linux::native_wayland() {
            window.set_position(tauri::PhysicalPosition::new(x, y))?;
        }
    }
    Ok(())
}

#[cfg(target_os = "macos")]
pub fn set_marquee_size(app: &AppHandle, width: u32, height: u32) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window("marquee") {
        window.set_size(tauri::Size::Logical(tauri::LogicalSize::new(
            width as f64,
            height as f64,
        )))?;
        if let Some(native) = ns_window(&window) {
            fit_marquee_glass(&native, current_bleed());
        }
    }
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn set_marquee_size(app: &AppHandle, width: u32, height: u32) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window("marquee") {
        let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize::new(
            width as f64,
            height as f64,
        )));
    }
    Ok(())
}
