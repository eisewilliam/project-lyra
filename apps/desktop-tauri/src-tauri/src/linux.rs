#[cfg(target_os = "linux")]
use tauri::WebviewWindow;

#[cfg(target_os = "linux")]
pub fn apply_ignore_cursor_events_when_ready(win: &WebviewWindow, ignore: bool) {
    use gtk::prelude::*;
    let win_clone = win.clone();
    let _ = win.run_on_main_thread(move || {
        let Ok(gtk_win) = win_clone.gtk_window() else {
            return;
        };
        if gtk_win.is_realized() {
            let _ = win_clone.set_ignore_cursor_events(ignore);
        } else {
            let win_inner = win_clone.clone();
            gtk_win.connect_realize(move |_| {
                let _ = win_inner.set_ignore_cursor_events(ignore);
            });
        }
    });
}

#[cfg(not(target_os = "linux"))]
pub fn apply_ignore_cursor_events_when_ready(win: &tauri::WebviewWindow, ignore: bool) {
    let _ = win.set_ignore_cursor_events(ignore);
}
