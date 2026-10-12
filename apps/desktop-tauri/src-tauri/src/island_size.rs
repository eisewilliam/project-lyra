//! Marquee sizing.
//!
//! The Marquee is laid out in logical points, which the OS already scales for
//! pixel density. What still differs between setups is how much of the screen
//! a panel of so many points covers: 600 points is 40% of a 13" laptop and 16%
//! of a 4K monitor at 100%. So the size the user picks is a scale on one base
//! design (width, height, type and artwork together), "Match screen" picks that
//! scale from the display's usable width, and the width never takes more than
//! a set share of the display it is on. Placed under a MacBook notch, the
//! content moves below the notch instead of behind it.
//!
//! [`island_frame`] is the pure calculation. [`fit_island`] measures the
//! window's display and placement, applies the result and tells the frontend.

use crate::ui_state::UiState;
use crate::AppState;
use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

/// Size choices, as multiples of the base design: Small, Medium, Large and
/// Extra large. Settings lists the same values.
pub const SCALE_STEPS: [f32; 4] = [0.85, 1.0, 1.2, 1.4];
/// Width of the base design (Medium), in points.
pub const DEFAULT_BASE_WIDTH: u32 = 600;
pub const MIN_BASE_WIDTH: u32 = 360;
pub const MAX_BASE_WIDTH: u32 = 900;
pub const DEFAULT_LINES: u8 = 2;

/// Base design heights, in points.
const TWO_LINE_HEIGHT: f64 = 72.0;
const ONE_LINE_HEIGHT: f64 = 56.0;
/// The widest the Marquee gets, as a share of its display's usable width.
const MAX_WORK_AREA_SHARE: f64 = 0.45;
/// The clamp never takes the Marquee narrower than this, in points.
const MIN_WIDTH: f64 = 300.0;
/// Room either side of the notch, so a panel under it never looks narrower
/// than the notch itself.
const NOTCH_SIDE_ROOM: f64 = 48.0;
/// "Match screen": the first scale whose usable-width limit (points) the
/// display is under. Laptops are read closer than desktop monitors, so these
/// keep the Marquee at about the same apparent size on each.
const AUTO_SCALE_LIMITS: [(f64, f32); 3] = [(1600.0, 0.85), (2200.0, 1.0), (3000.0, 1.2)];
const AUTO_SCALE_WIDEST: f32 = 1.4;

/// The notch on a MacBook display, in points from the display's left edge.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Notch {
    pub left: f64,
    pub right: f64,
    pub height: f64,
}

/// What [`island_frame`] needs to know about the display.
#[derive(Clone, Copy, Debug)]
pub struct Display {
    /// Usable width (without the Dock or taskbar), in points.
    pub work_area_width: f64,
    pub notch: Option<Notch>,
}

/// Where the Marquee is on its display.
#[derive(Clone, Copy, Debug)]
pub struct Placement {
    /// Horizontal centre, in points from the display's left edge.
    pub center_x: f64,
    /// The top edge is flush with the top of the display.
    pub at_top: bool,
}

/// The user's size preferences, as saved.
#[derive(Clone, Copy, Debug)]
pub struct SizePrefs {
    /// `None` matches the display.
    pub scale: Option<f32>,
    pub base_width: u32,
    pub lines: u8,
}

impl SizePrefs {
    pub fn from_ui(ui: &UiState) -> Self {
        Self {
            scale: ui.island_scale,
            base_width: ui.island_base_width,
            lines: ui.island_lines,
        }
    }
}

/// The Marquee's size on its current display. The frontend scales its layout
/// by `scale` and pads its content by `notch_inset`.
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
pub struct IslandFrame {
    pub scale: f32,
    /// `scale` was matched to the display rather than chosen.
    pub auto_scale: bool,
    pub width: u32,
    pub height: u32,
    /// Extra height at the top that sits behind the notch, in points.
    pub notch_inset: u32,
    /// The widest the Marquee may be dragged on this display, in points.
    pub max_width: u32,
}

pub fn auto_scale(work_area_width: f64) -> f32 {
    AUTO_SCALE_LIMITS
        .iter()
        .find(|(limit, _)| work_area_width < *limit)
        .map_or(AUTO_SCALE_WIDEST, |(_, scale)| *scale)
}

/// The size step closest to `scale`.
pub fn nearest_step(scale: f32) -> f32 {
    SCALE_STEPS
        .into_iter()
        .min_by(|a, b| (a - scale).abs().total_cmp(&(b - scale).abs()))
        .unwrap_or(1.0)
}

fn base_height(lines: u8) -> f64 {
    if lines <= 1 {
        ONE_LINE_HEIGHT
    } else {
        TWO_LINE_HEIGHT
    }
}

pub fn island_frame(prefs: SizePrefs, display: Display, placement: Placement) -> IslandFrame {
    let scale = match prefs.scale {
        Some(scale) if scale.is_finite() => nearest_step(scale),
        _ => auto_scale(display.work_area_width),
    };
    let base_width = prefs.base_width.clamp(MIN_BASE_WIDTH, MAX_BASE_WIDTH);
    let max_width = (display.work_area_width * MAX_WORK_AREA_SHARE).max(MIN_WIDTH);

    let mut width = (f64::from(base_width) * f64::from(scale)).min(max_width);
    let mut height = base_height(prefs.lines) * f64::from(scale);
    let mut notch_inset = 0.0;

    if let Some(notch) = display.notch.filter(|_| placement.at_top) {
        let half = width / 2.0;
        let overlaps =
            placement.center_x - half < notch.right && placement.center_x + half > notch.left;
        if overlaps {
            notch_inset = notch.height.ceil();
            height += notch_inset;
            width = width.max(notch.right - notch.left + 2.0 * NOTCH_SIDE_ROOM);
        }
    }

    IslandFrame {
        scale,
        auto_scale: prefs.scale.is_none(),
        width: width.round() as u32,
        height: height.round() as u32,
        notch_inset: notch_inset as u32,
        max_width: max_width.floor() as u32,
    }
}

/// Size preferences equivalent to a pre-scale saved width and height (both
/// in points): the closest size, the width at that size, and one line for
/// the old compact heights.
pub fn from_legacy_size(width: Option<u32>, height: u32) -> SizePrefs {
    let lines = if height <= 64 { 1 } else { 2 };
    let scale = nearest_step((f64::from(height) / base_height(lines)) as f32);
    let base_width = width.map_or(DEFAULT_BASE_WIDTH, |w| {
        ((f64::from(w) / f64::from(scale)).round() as u32).clamp(MIN_BASE_WIDTH, MAX_BASE_WIDTH)
    });
    SizePrefs {
        scale: Some(scale),
        base_width,
        lines,
    }
}

// ── Host ──────────────────────────────────────────────────────────────────────

/// The frame last applied to the Marquee window.
#[derive(Default)]
pub struct IslandFit {
    frame: Mutex<Option<IslandFrame>>,
}

impl IslandFit {
    pub fn current(&self) -> Option<IslandFrame> {
        *self.frame.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Store `frame`, returning whether it differs from the last one.
    fn replace(&self, frame: IslandFrame) -> bool {
        let mut slot = self.frame.lock().unwrap_or_else(|e| e.into_inner());
        let changed = *slot != Some(frame);
        *slot = Some(frame);
        changed
    }
}

/// A display that can't be measured is sized like a common desktop monitor.
const UNMEASURED_WORK_AREA_WIDTH: f64 = 1920.0;

/// Fit the Marquee window to its display, keeping its centre and top edge.
///
/// `resize` is true when the size preferences changed: the window takes the
/// new frame even if the frame matches the last one, for example after a
/// drag resize. Otherwise (the window moved) it is resized only when the frame
/// changed — a new display, or moving onto or off the notch — so moves during
/// a drag resize leave the dragged width alone.
pub fn fit_island(app: &AppHandle, resize: bool) {
    let handle = app.clone();
    // Window and screen geometry are AppKit calls on macOS.
    let _ = app.run_on_main_thread(move || fit_island_now(&handle, resize));
}

/// [`fit_island`], for callers already on the main thread.
pub fn fit_island_now(app: &AppHandle, resize: bool) {
    let Some(window) = app.get_webview_window("island") else {
        return;
    };
    let Ok(size) = window.outer_size() else {
        return;
    };
    let monitor = window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| window.primary_monitor().ok().flatten());
    // Wayland reports no window positions: the window is then sized in place.
    let position = window.outer_position().ok();
    let sf = monitor.as_ref().map_or_else(
        || window.scale_factor().unwrap_or(1.0),
        |m| m.scale_factor(),
    );
    if sf <= 0.0 {
        return;
    }

    let display = Display {
        work_area_width: monitor.as_ref().map_or(UNMEASURED_WORK_AREA_WIDTH, |m| {
            f64::from(m.work_area().size.width) / sf
        }),
        notch: crate::macos::display_notch(&window),
    };
    let placement = match (&monitor, position) {
        (Some(monitor), Some(position)) => {
            let center = f64::from(position.x) + f64::from(size.width) / 2.0;
            Placement {
                center_x: (center - f64::from(monitor.position().x)) / sf,
                at_top: (f64::from(position.y - monitor.position().y) / sf).abs() < 0.5,
            }
        }
        _ => Placement {
            center_x: 0.0,
            at_top: false,
        },
    };

    let state = app.state::<AppState>();
    let frame = island_frame(SizePrefs::from_ui(&state.ui.snapshot()), display, placement);
    let changed = state.island_fit.replace(frame);
    if !changed && !resize {
        return;
    }

    let current = size.to_logical::<f64>(sf);
    if (current.width - f64::from(frame.width)).abs() >= 1.0
        || (current.height - f64::from(frame.height)).abs() >= 1.0
    {
        let _ = crate::macos::set_island_size(app, frame.width, frame.height);
        if let (Some(monitor), Some(position)) = (&monitor, position) {
            keep_in_place(app, monitor, position, size, frame);
        }
    }
    if changed {
        let _ = app.emit("island-frame", frame);
    }
}

/// After a resize to `frame`, move the window so its centre and top edge stay
/// where they were, with the whole window on its display.
fn keep_in_place(
    app: &AppHandle,
    monitor: &tauri::Monitor,
    position: tauri::PhysicalPosition<i32>,
    size: tauri::PhysicalSize<u32>,
    frame: IslandFrame,
) {
    let sf = monitor.scale_factor();
    let width = (f64::from(frame.width) * sf).round() as i32;
    let height = (f64::from(frame.height) * sf).round() as i32;
    let center = position.x + size.width as i32 / 2;

    let left = monitor.position().x;
    let top = monitor.position().y;
    let right = left + monitor.size().width as i32;
    let bottom = top + monitor.size().height as i32;
    let x = (center - width / 2).clamp(left, (right - width).max(left));
    let y = position.y.clamp(top, (bottom - height).max(top));

    let _ = crate::macos::set_overlay_position(app, "island", x, y);
}

#[cfg(test)]
mod tests {
    use super::*;

    const LAPTOP: Display = Display {
        work_area_width: 1512.0,
        notch: None,
    };
    const DESKTOP_1440P: Display = Display {
        work_area_width: 2560.0,
        notch: None,
    };
    const NOTCHED: Display = Display {
        work_area_width: 1512.0,
        notch: Some(Notch {
            left: 662.0,
            right: 850.0,
            height: 32.0,
        }),
    };
    const CENTRED: Placement = Placement {
        center_x: 756.0,
        at_top: true,
    };
    const FLOATING: Placement = Placement {
        center_x: 756.0,
        at_top: false,
    };

    fn prefs(scale: Option<f32>) -> SizePrefs {
        SizePrefs {
            scale,
            base_width: DEFAULT_BASE_WIDTH,
            lines: 2,
        }
    }

    #[test]
    fn match_screen_picks_smaller_sizes_for_narrower_displays() {
        assert_eq!(auto_scale(1280.0), 0.85);
        assert_eq!(auto_scale(1512.0), 0.85);
        assert_eq!(auto_scale(1920.0), 1.0);
        assert_eq!(auto_scale(2560.0), 1.2);
        assert_eq!(auto_scale(3840.0), 1.4);
    }

    #[test]
    fn a_chosen_size_scales_width_and_height_together() {
        let frame = island_frame(prefs(Some(1.2)), DESKTOP_1440P, FLOATING);
        assert_eq!((frame.width, frame.height), (720, 86));
        assert_eq!(frame.scale, 1.2);
        assert!(!frame.auto_scale);
    }

    #[test]
    fn match_screen_is_reported_as_automatic() {
        let frame = island_frame(prefs(None), LAPTOP, FLOATING);
        assert!(frame.auto_scale);
        assert_eq!(frame.scale, 0.85);
        assert_eq!((frame.width, frame.height), (510, 61));
    }

    #[test]
    fn width_never_exceeds_its_share_of_the_display() {
        let frame = island_frame(prefs(Some(1.4)), LAPTOP, FLOATING);
        assert_eq!(frame.max_width, 680);
        assert_eq!(frame.width, 680);
        // Height keeps the chosen size; only the width gives way.
        assert_eq!(frame.height, 101);
    }

    #[test]
    fn one_line_is_shorter() {
        let mut one_line = prefs(Some(1.0));
        one_line.lines = 1;
        assert_eq!(island_frame(one_line, LAPTOP, FLOATING).height, 56);
    }

    #[test]
    fn content_moves_below_the_notch_only_when_under_it() {
        let under = island_frame(prefs(Some(1.0)), NOTCHED, CENTRED);
        assert_eq!(under.notch_inset, 32);
        assert_eq!(under.height, 104);

        let floating = island_frame(prefs(Some(1.0)), NOTCHED, FLOATING);
        assert_eq!(floating.notch_inset, 0);

        let beside = Placement {
            center_x: 200.0,
            at_top: true,
        };
        assert_eq!(
            island_frame(prefs(Some(1.0)), NOTCHED, beside).notch_inset,
            0
        );
    }

    #[test]
    fn a_panel_under_the_notch_is_wider_than_the_notch() {
        let narrow = SizePrefs {
            scale: Some(0.85),
            base_width: MIN_BASE_WIDTH,
            lines: 1,
        };
        let wide_notch = Display {
            work_area_width: 1512.0,
            notch: Some(Notch {
                left: 556.0,
                right: 956.0,
                height: 38.0,
            }),
        };
        let frame = island_frame(narrow, wide_notch, CENTRED);
        assert_eq!(frame.width, 496);
    }

    #[test]
    fn legacy_sizes_map_to_the_closest_size_and_line_count() {
        let compact = from_legacy_size(Some(500), 52);
        assert_eq!(
            (compact.scale, compact.lines, compact.base_width),
            (Some(1.0), 1, 500)
        );

        let tall = from_legacy_size(Some(800), 104);
        assert_eq!((tall.scale, tall.lines), (Some(1.4), 2));
        assert_eq!(tall.base_width, 571);

        let standard = from_legacy_size(None, 72);
        assert_eq!(
            (standard.scale, standard.base_width),
            (Some(1.0), DEFAULT_BASE_WIDTH)
        );
    }
}
