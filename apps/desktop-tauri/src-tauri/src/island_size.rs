//! Marquee sizing and placement.
//!
//! The Marquee is laid out in logical points, which the OS already scales for
//! pixel density. What still differs between setups is how much of the screen
//! a panel of so many points covers: 600 points is 40% of a 13" laptop and 16%
//! of a 4K monitor at 100%. So the size the user picks is a scale on one base
//! design (width, height, type and artwork together), "Match screen" picks that
//! scale from the display's usable width, and the width never takes more than
//! a set share of the display it is on.
//!
//! The Marquee goes wherever the user puts it. Until they move it, it sits
//! centred a margin above the bottom of the display's safe area: the part
//! apps' windows get, without the menu bar, Dock or taskbar, and below a
//! MacBook's notch. While Karaoke is on, the safe area also stops short of the
//! Karaoke lyrics. Released after a drag, it stays inside the safe area where
//! it was let go, or on an edge margin or the centre line when close to one.
//! Pushed up against the top edge of the display instead, it docks there, over
//! the menu bar; under a MacBook notch the window grows by the notch height
//! and its content sits below the notch.
//!
//! [`island_frame`], [`default_origin`], [`settle_origin`] and
//! [`refit_origin`] are the pure calculations. [`fit_island`],
//! [`place_island`] and [`settle_island`] measure the window's display, apply
//! the result and tell the frontend.

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

/// Gap between a settled Marquee and the edge of the safe area, in points.
const EDGE_MARGIN: f64 = 12.0;
/// A Marquee released this close to an edge margin or the centre line
/// settles on it, in points.
const SNAP_DISTANCE: f64 = 32.0;

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
    pub docked: bool,
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
/// by `scale`, pads its content by `notch_inset` and squares its top corners
/// while `docked`.
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
pub struct IslandFrame {
    pub scale: f32,
    /// `scale` was matched to the display rather than chosen.
    pub auto_scale: bool,
    pub width: u32,
    pub height: u32,
    /// Extra height at the top that sits behind the notch, in points.
    pub notch_inset: u32,
    /// Docked against the top edge of the display.
    pub docked: bool,
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

    if let Some(notch) = display.notch.filter(|_| placement.docked) {
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
        docked: placement.docked,
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

// ── Placement ─────────────────────────────────────────────────────────────────

/// The part of a display a settled Marquee keeps to, in points from the
/// display's top-left corner, unless it is docked against the top edge.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SafeArea {
    pub left: f64,
    pub top: f64,
    pub right: f64,
    pub bottom: f64,
    /// A Marquee released with its top edge at or above this line docks
    /// against the top of the display: halfway up the menu bar or notch, or
    /// the display's edge itself where nothing sits above the work area.
    pub dock_line: f64,
}

impl SafeArea {
    /// The display's work area (points from its top-left corner), kept below
    /// `top_inset`: the notch on a MacBook, which the work area alone leaves
    /// open when the menu bar hides itself.
    pub fn new(left: f64, top: f64, width: f64, height: f64, top_inset: f64) -> Self {
        let safe_top = top.max(top_inset);
        Self {
            left,
            top: safe_top,
            right: left + width,
            bottom: top + height,
            dock_line: safe_top / 2.0,
        }
    }

    /// The part of the area on the far side of a band across the display
    /// (`top` to `bottom`, points), such as the Karaoke lyrics: below a band
    /// in the upper half, above one in the lower half. Docking against the top
    /// edge is unaffected.
    pub fn clear_of(self, top: f64, bottom: f64) -> Self {
        if bottom <= self.top || top >= self.bottom {
            return self;
        }
        if top + bottom < self.top + self.bottom {
            Self {
                top: self.top.max(bottom),
                ..self
            }
        } else {
            Self {
                bottom: self.bottom.min(top),
                ..self
            }
        }
    }

    fn center_x(&self) -> f64 {
        (self.left + self.right) / 2.0
    }
}

/// Top-left corner (points) of a `width` × `height` Marquee the user has not
/// placed: centred, a margin above the bottom of the safe area. Never docked,
/// so it never starts under a notch or against the top edge.
pub fn default_origin(area: SafeArea, width: f64, height: f64) -> (f64, f64) {
    (
        contain(area.left, area.right, area.center_x() - width / 2.0, width),
        contain(
            area.top,
            area.bottom,
            area.bottom - EDGE_MARGIN - height,
            height,
        ),
    )
}

/// Where a Marquee released with its top-left corner at (`x`, `y`) settles.
/// Pushed up to the dock line, it docks flush against the top of the display.
/// Otherwise it stays wholly inside the safe area. Either way it moves onto an
/// edge margin or the centre line when it is close to one.
pub fn settle_origin(area: SafeArea, x: f64, y: f64, width: f64, height: f64) -> (f64, f64) {
    let x = contain(area.left, area.right, x, width);
    let x = snap(
        x,
        &[
            area.left + EDGE_MARGIN,
            area.center_x() - width / 2.0,
            area.right - EDGE_MARGIN - width,
        ],
    );
    let x = contain(area.left, area.right, x, width);
    if y <= area.dock_line {
        return (x, 0.0);
    }
    let y = contain(area.top, area.bottom, y, height);
    let y = snap(
        y,
        &[area.top + EDGE_MARGIN, area.bottom - EDGE_MARGIN - height],
    );
    (x, contain(area.top, area.bottom, y, height))
}

/// Top-left corner (points) after the Marquee at (`x`, `y`) changes size from
/// `old` to `new` (width, height): its centre stays, and so does whichever of
/// its top and bottom edges is nearer the matching edge of the safe area, so
/// a Marquee near the bottom grows upwards and a docked one stays docked.
pub fn refit_origin(
    area: SafeArea,
    x: f64,
    y: f64,
    old: (f64, f64),
    new: (f64, f64),
) -> (f64, f64) {
    let x = x + (old.0 - new.0) / 2.0;
    let room_above = y - area.top;
    let room_below = area.bottom - (y + old.1);
    let y = if room_below < room_above {
        y + old.1 - new.1
    } else {
        y
    };
    settle_origin(area, x, y, new.0, new.1)
}

/// Keep a span of `size` starting at `start` between `low` and `high`. One
/// longer than that keeps its start in it.
fn contain(low: f64, high: f64, start: f64, size: f64) -> f64 {
    start.min(high - size).max(low)
}

/// The closest of `targets` within snapping distance of `value`, or `value`.
fn snap(value: f64, targets: &[f64]) -> f64 {
    targets
        .iter()
        .copied()
        .filter(|target| (target - value).abs() <= SNAP_DISTANCE)
        .min_by(|a, b| (a - value).abs().total_cmp(&(b - value).abs()))
        .unwrap_or(value)
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

/// The display the Marquee is on, or the primary display when it is on none.
fn island_monitor(window: &tauri::WebviewWindow) -> Option<tauri::Monitor> {
    window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| window.primary_monitor().ok().flatten())
}

/// The safe area of `monitor`, clear of the Karaoke lyrics while they are on.
/// The notch is measured on the display the window is on, so it only counts
/// when that is `monitor`. Call on the main thread.
fn safe_area(app: &AppHandle, window: &tauri::WebviewWindow, monitor: &tauri::Monitor) -> SafeArea {
    let on_monitor = window
        .current_monitor()
        .ok()
        .flatten()
        .is_some_and(|current| current.position() == monitor.position());
    let top_inset = on_monitor
        .then(|| crate::macos::display_notch(window))
        .flatten()
        .map_or(0.0, |notch| notch.height);
    let sf = monitor.scale_factor();
    let work = monitor.work_area();
    let area = SafeArea::new(
        f64::from(work.position.x - monitor.position().x) / sf,
        f64::from(work.position.y - monitor.position().y) / sf,
        f64::from(work.size.width) / sf,
        f64::from(work.size.height) / sf,
        top_inset,
    );
    match karaoke_band(app, monitor) {
        Some((top, bottom)) => area.clear_of(top, bottom),
        None => area,
    }
}

/// The top and bottom of the Karaoke lyrics (points from `monitor`'s top
/// edge) while Karaoke is turned on and on `monitor`. Karaoke that auto-hide
/// hid still counts, so the Marquee doesn't jump each time a song pauses.
fn karaoke_band(app: &AppHandle, monitor: &tauri::Monitor) -> Option<(f64, f64)> {
    let (_, _, karaoke_on) = app.state::<AppState>().ui.visibility_triple();
    if !karaoke_on {
        return None;
    }
    let window = app.get_webview_window("karaoke")?;
    let on_monitor = window
        .current_monitor()
        .ok()
        .flatten()
        .is_some_and(|current| current.position() == monitor.position());
    if !on_monitor {
        return None;
    }
    let position = window.outer_position().ok()?;
    let size = window.outer_size().ok()?;
    let sf = monitor.scale_factor();
    let top = f64::from(position.y - monitor.position().y) / sf;
    Some((top, top + f64::from(size.height) / sf))
}

/// The window's size in points.
fn window_points(window: &tauri::WebviewWindow) -> Option<(f64, f64)> {
    let size = window.outer_size().ok()?;
    let sf = window.scale_factor().ok().filter(|sf| *sf > 0.0)?;
    Some((f64::from(size.width) / sf, f64::from(size.height) / sf))
}

/// The window's top-left corner in points from `monitor`'s top-left corner.
fn origin_on(window: &tauri::WebviewWindow, monitor: &tauri::Monitor) -> Option<(f64, f64)> {
    // Wayland reports no window positions.
    let position = window.outer_position().ok()?;
    let sf = monitor.scale_factor();
    Some((
        f64::from(position.x - monitor.position().x) / sf,
        f64::from(position.y - monitor.position().y) / sf,
    ))
}

/// Move the Marquee's top-left corner to `origin` (points on `monitor`),
/// returning the position in physical pixels, as saved.
fn move_island(app: &AppHandle, monitor: &tauri::Monitor, origin: (f64, f64)) -> (i32, i32) {
    let sf = monitor.scale_factor();
    let x = monitor.position().x + (origin.0 * sf).round() as i32;
    let y = monitor.position().y + (origin.1 * sf).round() as i32;
    let _ = crate::macos::set_overlay_position(app, "island", x, y);
    (x, y)
}

/// Save `position` as the Marquee's place.
fn remember_position(app: &AppHandle, position: (i32, i32)) {
    let new_state = app
        .state::<AppState>()
        .ui
        .mutate(|s| s.island_pos = Some(position));
    let _ = app.emit("ui-settings-changed", new_state);
}

/// Fit the Marquee window to its display and placement.
///
/// `resize` is true when the size preferences changed: the window takes the
/// new frame even if the frame matches the last one, for example after a
/// drag resize. Otherwise (the window moved) it is resized only when the frame
/// changed — a display with a different width, or docking under the notch or
/// leaving it — so moves during a drag resize leave the dragged width alone.
/// A resized Marquee keeps its centre and the edge nearer the top or bottom of
/// its display.
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
    let Some(current) = window_points(&window) else {
        return;
    };
    let monitor = island_monitor(&window);
    let display = Display {
        work_area_width: monitor.as_ref().map_or(UNMEASURED_WORK_AREA_WIDTH, |m| {
            f64::from(m.work_area().size.width) / m.scale_factor()
        }),
        notch: crate::macos::display_notch(&window),
    };
    // Wayland reports no window positions: the window is then sized as if
    // floating.
    let placement = monitor
        .as_ref()
        .and_then(|monitor| origin_on(&window, monitor))
        .map_or(
            Placement {
                center_x: 0.0,
                docked: false,
            },
            |(x, y)| Placement {
                center_x: x + current.0 / 2.0,
                docked: y.abs() < 0.5,
            },
        );

    let state = app.state::<AppState>();
    let ui = state.ui.snapshot();
    let frame = island_frame(SizePrefs::from_ui(&ui), display, placement);
    let changed = state.island_fit.replace(frame);
    if !changed && !resize {
        return;
    }

    let new = (f64::from(frame.width), f64::from(frame.height));
    if (current.0 - new.0).abs() >= 1.0 || (current.1 - new.1).abs() >= 1.0 {
        let origin = monitor
            .as_ref()
            .and_then(|monitor| Some((monitor, origin_on(&window, monitor)?)));
        // Only a window at its saved place moves the saved place with it; at
        // startup the window is sized before it is restored there.
        let at_saved_place = window.outer_position().ok().is_some_and(|position| {
            ui.island_pos
                .is_some_and(|(x, y)| (position.x - x).abs() <= 1 && (position.y - y).abs() <= 1)
        });
        let _ = crate::macos::set_island_size(app, frame.width, frame.height);
        // Without a position (Wayland) the window is resized in place.
        if let Some((monitor, (x, y))) = origin {
            let area = safe_area(app, &window, monitor);
            let moved = move_island(app, monitor, refit_origin(area, x, y, current, new));
            if at_saved_place && ui.island_pos != Some(moved) {
                remember_position(app, moved);
            }
        }
    }
    if changed {
        let _ = app.emit("island-frame", frame);
    }
}

/// Put the Marquee in its place: where the user left it, settled into the
/// safe area of the display it is on, or else the default place on `monitor`
/// (the display it is on when `None`). Runs again when Karaoke is turned on
/// or off or its lyrics move, so the Marquee moves out of their way and back.
pub fn place_island(app: &AppHandle, monitor: Option<tauri::Monitor>) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || place_island_now(&handle, monitor));
}

fn place_island_now(app: &AppHandle, monitor: Option<tauri::Monitor>) {
    let Some(window) = app.get_webview_window("island") else {
        return;
    };
    forget_old_default_place(app, &window);
    if let Some(saved) = app.state::<AppState>().ui.snapshot().island_pos {
        let _ = crate::macos::set_overlay_position(app, "island", saved.0, saved.1);
        // A place saved on a display that is gone, or now behind the Karaoke
        // lyrics, moves into a safe area; a docked one stays docked. The saved
        // place stays, so it comes back when that changes.
        settle_island_now(app);
        return;
    }
    let Some(monitor) = monitor.or_else(|| island_monitor(&window)) else {
        return;
    };
    let Some((width, height)) = window_points(&window) else {
        return;
    };
    let area = safe_area(app, &window, &monitor);
    move_island(app, &monitor, default_origin(area, width, height));
}

/// Earlier versions saved the Marquee's starting place, centred against the
/// top edge, as though the user had put it there. Forget such a place once,
/// so that Marquee starts in today's default place. A Marquee the user docked
/// near the top centre then moves too; one anywhere else keeps its place.
fn forget_old_default_place(app: &AppHandle, window: &tauri::WebviewWindow) {
    let state = app.state::<AppState>();
    let ui = state.ui.snapshot();
    if ui.island_pos_checked {
        return;
    }
    let width = window.outer_size().map_or(0, |size| size.width as i32);
    let monitors = window.available_monitors().unwrap_or_default();
    let old_default = ui.island_pos.is_some_and(|(x, y)| {
        monitors.iter().any(|monitor| {
            let monitor_width = monitor.size().width as i32;
            let center = monitor.position().x + monitor_width / 2;
            y == monitor.position().y && (x + width / 2 - center).abs() <= monitor_width / 10
        })
    });
    let new_state = state.ui.mutate(|s| {
        s.island_pos_checked = true;
        if old_default {
            s.island_pos = None;
        }
    });
    if old_default {
        let _ = app.emit("ui-settings-changed", new_state);
    }
}

/// Settle the Marquee after the user drags it, and save where it ends up.
pub fn settle_island(app: &AppHandle) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(settled) = settle_island_now(&handle) {
            remember_position(&handle, settled);
        }
    });
}

/// Move the Marquee to where it settles on the display it is on, returning
/// its position in physical pixels. Call on the main thread.
fn settle_island_now(app: &AppHandle) -> Option<(i32, i32)> {
    let window = app.get_webview_window("island")?;
    let monitor = island_monitor(&window)?;
    let (width, height) = window_points(&window)?;
    let (x, y) = origin_on(&window, &monitor)?;
    let area = safe_area(app, &window, &monitor);
    Some(move_island(
        app,
        &monitor,
        settle_origin(area, x, y, width, height),
    ))
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
    const DOCKED: Placement = Placement {
        center_x: 756.0,
        docked: true,
    };
    const FLOATING: Placement = Placement {
        center_x: 756.0,
        docked: false,
    };
    const MARQUEE: (f64, f64) = (510.0, 61.0);

    /// A 14" MacBook Pro: the menu bar above and the Dock below.
    fn laptop_area() -> SafeArea {
        SafeArea::new(0.0, 37.0, 1512.0, 873.0, 0.0)
    }

    fn prefs(scale: Option<f32>) -> SizePrefs {
        SizePrefs {
            scale,
            base_width: DEFAULT_BASE_WIDTH,
            lines: 2,
        }
    }

    fn settle(x: f64, y: f64) -> (f64, f64) {
        settle_origin(laptop_area(), x, y, MARQUEE.0, MARQUEE.1)
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
    fn content_moves_below_the_notch_only_when_docked_under_it() {
        let under = island_frame(prefs(Some(1.0)), NOTCHED, DOCKED);
        assert_eq!(under.notch_inset, 32);
        assert_eq!(under.height, 104);
        assert!(under.docked);

        let floating = island_frame(prefs(Some(1.0)), NOTCHED, FLOATING);
        assert_eq!(floating.notch_inset, 0);
        assert!(!floating.docked);

        let beside = Placement {
            center_x: 200.0,
            docked: true,
        };
        let frame = island_frame(prefs(Some(1.0)), NOTCHED, beside);
        assert_eq!(frame.notch_inset, 0);
        assert!(frame.docked);
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
        assert_eq!(island_frame(narrow, wide_notch, DOCKED).width, 496);
    }

    #[test]
    fn the_safe_area_stays_below_the_notch_when_the_menu_bar_hides() {
        let area = SafeArea::new(0.0, 0.0, 1512.0, 982.0, 32.0);
        assert_eq!((area.top, area.bottom, area.dock_line), (32.0, 982.0, 16.0));
        // With the menu bar showing, the work area already clears the notch.
        assert_eq!(SafeArea::new(0.0, 37.0, 1512.0, 873.0, 32.0).top, 37.0);
    }

    #[test]
    fn the_safe_area_stops_short_of_the_karaoke_lyrics() {
        // Karaoke at the bottom: the Marquee keeps above it.
        let below = laptop_area().clear_of(808.0, 898.0);
        assert_eq!((below.top, below.bottom), (37.0, 808.0));
        assert_eq!(default_origin(below, MARQUEE.0, MARQUEE.1), (501.0, 735.0));
        // Karaoke at the top: the Marquee keeps below it, but can still dock.
        let above = laptop_area().clear_of(49.0, 139.0);
        assert_eq!((above.top, above.bottom), (139.0, 910.0));
        assert_eq!(
            settle_origin(above, 501.0, -5.0, MARQUEE.0, MARQUEE.1),
            (501.0, 0.0)
        );
        // Karaoke on another part of the display changes nothing.
        assert_eq!(laptop_area().clear_of(910.0, 970.0), laptop_area());
    }

    #[test]
    fn by_default_the_marquee_sits_centred_above_the_dock() {
        assert_eq!(
            default_origin(laptop_area(), MARQUEE.0, MARQUEE.1),
            (501.0, 837.0)
        );
    }

    #[test]
    fn released_just_into_the_menu_bar_it_settles_below_it() {
        assert_eq!(settle(501.0, 25.0), (501.0, 49.0));
    }

    #[test]
    fn pushed_against_the_top_edge_it_docks_there() {
        assert_eq!(settle(480.0, 4.0), (501.0, 0.0));
        assert_eq!(settle(1100.0, -30.0), (990.0, 0.0));
        // Without a menu bar the top edge itself is the line.
        let desktop = SafeArea::new(0.0, 0.0, 1920.0, 1032.0, 0.0);
        assert_eq!(
            settle_origin(desktop, 705.0, 5.0, 510.0, 61.0),
            (705.0, 12.0)
        );
        assert_eq!(
            settle_origin(desktop, 705.0, -8.0, 510.0, 61.0),
            (705.0, 0.0)
        );
    }

    #[test]
    fn released_away_from_edges_it_stays_where_it_was_let_go() {
        assert_eq!(settle(300.0, 400.0), (300.0, 400.0));
    }

    #[test]
    fn released_near_the_centre_line_or_an_edge_it_settles_there() {
        assert_eq!(settle(480.0, 400.0), (501.0, 400.0));
        assert_eq!(settle(30.0, 400.0), (12.0, 400.0));
        // Dragged partly off the right edge and into the Dock.
        assert_eq!(settle(1400.0, 900.0), (990.0, 837.0));
    }

    #[test]
    fn a_resized_marquee_keeps_its_nearer_edge() {
        let area = laptop_area();
        assert_eq!(
            refit_origin(area, 501.0, 837.0, MARQUEE, (510.0, 48.0)),
            (501.0, 850.0)
        );
        assert_eq!(
            refit_origin(area, 501.0, 49.0, MARQUEE, (600.0, 72.0)),
            (456.0, 49.0)
        );
        // Docked under the notch, it grows downwards and stays docked.
        assert_eq!(
            refit_origin(area, 501.0, 0.0, MARQUEE, (600.0, 93.0)),
            (456.0, 0.0)
        );
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
