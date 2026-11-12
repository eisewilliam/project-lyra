//! Linux-only window plumbing. Every function also exists on the other
//! platforms, where it does the plain thing, so callers need no `cfg`.

#[cfg(target_os = "linux")]
mod imp {
    use std::collections::BTreeMap;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Mutex;
    use tauri::WebviewWindow;

    /// Set once at startup by `prefer_x11`.
    static NATIVE_WAYLAND: AtomicBool = AtomicBool::new(false);

    /// Click-through wanted by windows that are not realized yet, by label.
    /// An entry also means the window already has its realize handler.
    static PENDING_CLICK_THROUGH: Mutex<BTreeMap<String, bool>> = Mutex::new(BTreeMap::new());

    /// Whether GDK's backend list starts with X11 (`x11` or `x11,wayland`).
    fn backend_prefers_x11(backend: Option<&str>) -> bool {
        backend
            .and_then(|list| list.split(',').next())
            .is_some_and(|first| first.trim() == "x11")
    }

    /// The backend to force, if any. A Wayland session with XWayland runs
    /// Lyra as an X11 client; an explicit `GDK_BACKEND` is left alone.
    fn forced_backend(
        backend: Option<&str>,
        wayland_session: bool,
        x11_available: bool,
    ) -> Option<&'static str> {
        (backend.is_none() && wayland_session && x11_available).then_some("x11")
    }

    /// Run Lyra through XWayland on Wayland sessions.
    ///
    /// A Wayland client cannot place its own windows, read where they are, or
    /// keep them above other apps, which the Marquee and Karaoke surfaces all
    /// depend on. X11 clients can. Must run before GTK starts and before any
    /// thread is spawned (it changes the process environment).
    pub fn prefer_x11() {
        let backend = std::env::var("GDK_BACKEND").ok();
        let wayland_session = std::env::var_os("WAYLAND_DISPLAY").is_some();
        let x11_available = std::env::var_os("DISPLAY").is_some();

        let forced = forced_backend(backend.as_deref(), wayland_session, x11_available);
        if let Some(forced) = forced {
            std::env::set_var("GDK_BACKEND", forced);
        }
        let x11 = forced.is_some() || backend_prefers_x11(backend.as_deref());
        NATIVE_WAYLAND.store(wayland_session && !x11, Ordering::Relaxed);
    }

    /// True when Lyra runs as a native Wayland client (no XWayland, or the
    /// user set `GDK_BACKEND`). Window positions are then neither readable
    /// nor settable.
    pub fn native_wayland() -> bool {
        NATIVE_WAYLAND.load(Ordering::Relaxed)
    }

    /// Set click-through on a window that may not be on screen yet.
    ///
    /// GTK applies click-through to the window's GDK surface, which exists
    /// only once the window is realized (first shown); asking earlier aborts
    /// the app. Until then the latest wanted value is kept and applied when
    /// the window is realized.
    pub fn apply_ignore_cursor_events_when_ready(win: &WebviewWindow, ignore: bool) {
        use gtk::prelude::*;
        let window = win.clone();
        let _ = win.run_on_main_thread(move || {
            let Ok(gtk_win) = window.gtk_window() else {
                return;
            };
            if gtk_win.is_realized() {
                let _ = window.set_ignore_cursor_events(ignore);
                return;
            }
            let label = window.label().to_string();
            let first = PENDING_CLICK_THROUGH
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .insert(label.clone(), ignore)
                .is_none();
            if first {
                gtk_win.connect_realize(move |_| {
                    let wanted = PENDING_CLICK_THROUGH
                        .lock()
                        .unwrap_or_else(|e| e.into_inner())
                        .get(&label)
                        .copied();
                    if let Some(ignore) = wanted {
                        let _ = window.set_ignore_cursor_events(ignore);
                    }
                });
            }
        });
    }

    #[cfg(test)]
    mod tests {
        use super::{backend_prefers_x11, forced_backend};

        #[test]
        fn wayland_sessions_with_xwayland_run_on_x11() {
            assert_eq!(forced_backend(None, true, true), Some("x11"));
        }

        #[test]
        fn other_sessions_and_explicit_choices_are_left_alone() {
            // Plain X11 session: GDK already picks X11.
            assert_eq!(forced_backend(None, false, true), None);
            // Wayland without XWayland: nothing to fall back to.
            assert_eq!(forced_backend(None, true, false), None);
            // The user chose a backend.
            assert_eq!(forced_backend(Some("wayland"), true, true), None);
            assert_eq!(forced_backend(Some("x11"), true, true), None);
        }

        #[test]
        fn backend_list_is_read_by_its_first_entry() {
            assert!(backend_prefers_x11(Some("x11")));
            assert!(backend_prefers_x11(Some("x11,wayland")));
            assert!(!backend_prefers_x11(Some("wayland,x11")));
            assert!(!backend_prefers_x11(None));
        }
    }
}

#[cfg(target_os = "linux")]
pub use imp::{apply_ignore_cursor_events_when_ready, native_wayland, prefer_x11};

#[cfg(not(target_os = "linux"))]
pub fn apply_ignore_cursor_events_when_ready(win: &tauri::WebviewWindow, ignore: bool) {
    let _ = win.set_ignore_cursor_events(ignore);
}

#[cfg(not(target_os = "linux"))]
pub fn native_wayland() -> bool {
    false
}
