//! A pop-up menu drawn by AppKit with SF Symbols and second lines, neither of
//! which Tauri's menu API can set. The web view describes the rows; the host
//! shows the menu, waits for it to close and reports which row was chosen,
//! and the web view then runs that row's action. Other platforms use Tauri's
//! own menu from the web view instead.
//!
//! AppKit tracks an open menu in a loop on the main thread. Tauri's own menu
//! starts that loop inside a callback of its event loop, which then holds
//! every event, so `playback-tick` stops reaching the windows and the lyrics
//! stop moving until the menu closes. This menu starts from the main dispatch
//! queue instead, outside that callback, so events keep flowing meanwhile.

use serde::Deserialize;

/// One row of the menu, or a separator when `id` is absent.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub struct NativeMenuItem {
    id: Option<String>,
    #[serde(default)]
    title: String,
    /// SF Symbol name; left out where this macOS has no such symbol.
    symbol: Option<String>,
    /// Second line under the title, on macOS 14.4 and later.
    subtitle: Option<String>,
    #[serde(default = "enabled_by_default")]
    enabled: bool,
}

fn enabled_by_default() -> bool {
    true
}

/// Show the menu with its top-left corner at `at` (logical points from the
/// window's top-left), or at the pointer, and return the chosen row's id.
#[cfg(target_os = "macos")]
pub async fn show(
    window: &tauri::WebviewWindow,
    items: Vec<NativeMenuItem>,
    at: Option<(f64, f64)>,
) -> Result<Option<String>, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    let target_window = window.clone();
    // Not `run_on_main_thread`: see the module comment.
    dispatch2::DispatchQueue::main().exec_async(move || {
        let _ = tx.send(native::show(&target_window, &items, at));
    });
    tauri::async_runtime::spawn_blocking(move || rx.recv().ok().flatten())
        .await
        .map_err(|error| error.to_string())
}

#[cfg(not(target_os = "macos"))]
pub async fn show(
    _window: &tauri::WebviewWindow,
    _items: Vec<NativeMenuItem>,
    _at: Option<(f64, f64)>,
) -> Result<Option<String>, String> {
    Err("Native menus are drawn by the web view on this platform".into())
}

#[cfg(target_os = "macos")]
mod native {
    use super::NativeMenuItem;
    use objc2::rc::Retained;
    use objc2::runtime::{AnyObject, NSObject};
    use objc2::{define_class, msg_send, sel, MainThreadMarker, MainThreadOnly};
    use objc2_app_kit::{NSEvent, NSImage, NSMenu, NSMenuItem, NSView};
    use objc2_foundation::{
        ns_string, NSObjectProtocol, NSOperatingSystemVersion, NSPoint, NSProcessInfo, NSString,
    };
    use std::cell::Cell;

    thread_local! {
        /// Tag of the row chosen in the menu being tracked.
        static CHOSEN: Cell<Option<isize>> = const { Cell::new(None) };
    }

    define_class!(
        /// Records which row was chosen; AppKit sends the action before the
        /// menu's tracking call returns.
        #[unsafe(super(NSObject))]
        #[thread_kind = MainThreadOnly]
        #[name = "LyraMenuTarget"]
        struct Target;

        unsafe impl NSObjectProtocol for Target {}

        impl Target {
            #[unsafe(method(choose:))]
            fn choose(&self, sender: Option<&NSMenuItem>) {
                CHOSEN.set(sender.map(NSMenuItem::tag));
            }
        }
    );

    pub fn show(
        window: &tauri::WebviewWindow,
        items: &[NativeMenuItem],
        at: Option<(f64, f64)>,
    ) -> Option<String> {
        let mtm = MainThreadMarker::new()?;
        let view_ptr = window.ns_view().ok()?.cast::<NSView>();
        // SAFETY: Tauri returns the window's live content view, or null.
        let view = unsafe { Retained::retain(view_ptr) }?;

        // Like the app menu (`menu::apply_symbols`): menus carry icons from
        // macOS 26, where AppKit gives its own items one. Second lines need
        // 14.4 and are checked per row.
        let tahoe = NSOperatingSystemVersion {
            majorVersion: 26,
            minorVersion: 0,
            patchVersion: 0,
        };
        let has_symbols = NSProcessInfo::processInfo().isOperatingSystemAtLeastVersion(tahoe);
        let target: Retained<Target> = unsafe { msg_send![Target::alloc(mtm), init] };
        let menu = NSMenu::new(mtm);
        menu.setAutoenablesItems(false);

        for (index, item) in items.iter().enumerate() {
            if item.id.is_none() {
                menu.addItem(&NSMenuItem::separatorItem(mtm));
                continue;
            }
            // SAFETY: `choose:` is implemented by `Target`.
            let row = unsafe {
                NSMenuItem::initWithTitle_action_keyEquivalent(
                    NSMenuItem::alloc(mtm),
                    &NSString::from_str(&item.title),
                    Some(sel!(choose:)),
                    ns_string!(""),
                )
            };
            let target_object: &AnyObject = &target;
            // SAFETY: the target outlives the menu's tracking below.
            unsafe { row.setTarget(Some(target_object)) };
            row.setTag(index as isize);
            row.setEnabled(item.enabled);
            if let Some(symbol) = item.symbol.as_deref().filter(|_| has_symbols) {
                let image = NSImage::imageWithSystemSymbolName_accessibilityDescription(
                    &NSString::from_str(symbol),
                    None,
                );
                row.setImage(image.as_deref());
            }
            if let Some(subtitle) = &item.subtitle {
                if row.respondsToSelector(sel!(setSubtitle:)) {
                    row.setSubtitle(Some(&NSString::from_str(subtitle)));
                }
            }
            menu.addItem(&row);
        }

        CHOSEN.set(None);
        match at {
            Some((x, y)) => {
                // The content view's origin is at its bottom left unless flipped.
                let y = if view.isFlipped() {
                    y
                } else {
                    view.frame().size.height - y
                };
                menu.popUpMenuPositioningItem_atLocation_inView(
                    None,
                    NSPoint::new(x, y),
                    Some(&view),
                );
            }
            // Without a view, the location is in screen coordinates.
            None => {
                menu.popUpMenuPositioningItem_atLocation_inView(
                    None,
                    NSEvent::mouseLocation(),
                    None,
                );
            }
        }
        let chosen = CHOSEN.take()?;
        items.get(usize::try_from(chosen).ok()?)?.id.clone()
    }
}
