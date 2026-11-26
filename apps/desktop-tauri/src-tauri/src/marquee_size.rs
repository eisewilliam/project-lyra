//! Marquee sizing, multi-edge/corner attachment, and liquid drag physics.
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
//! Karaoke lyrics. Released after a drag inside the safe area, it stays where
//! it was let go, or snaps to an edge margin or guide line when close to one.
//! Pushed past the dock threshold on any screen edge (top, bottom, left, right)
//! or corner, it attaches flush against the physical display edge; under a
//! MacBook notch the window grows by the notch height and its content sits
//! below the notch.
//!
//! Dragging a docked panel away from an attached edge builds surface tension
//! while clinging flush to the edge until it crosses `BREAKAWAY_PX`, where it
//! snaps off smoothly and chases the pointer via a critically damped spring.

use crate::ui_state::UiState;
use crate::AppState;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
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

/// Gap between a settled floating Marquee and the edge of the safe area, in points.
const EDGE_MARGIN: f64 = 12.0;
/// A Marquee released this close to an edge margin or guide line settles on it.
const SNAP_DISTANCE: f64 = 32.0;

/// Corner radius of the Marquee pill, in points (matches `marquee.css` & `macos.rs`).
const MARQUEE_RADIUS: f64 = 20.0;
/// Perpendicular pull distance (points) required to break away from a docked edge.
pub const BREAKAWAY_PX: f64 = 34.0;
/// Push distance (points) past a shared interior monitor border to cross onto an adjacent display.
pub const MULTI_MONITOR_BREAKAWAY_PX: f64 = 44.0;
/// Margin inside an adjacent display before its entry edge can re-latch.
const ENTRY_SUPPRESS_CLEARANCE_PT: f64 = 16.0;
/// Edge proximity threshold (points) for live attachment when an edge has zero OS inset.
const ZERO_INSET_LIVE_TRIGGER_PT: f64 = 2.0;

/// Screen edges the Marquee is attached to. Any orthogonal combination (e.g.
/// `top + right`) represents corner attachment.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct DockEdges {
    #[serde(default)]
    pub top: bool,
    #[serde(default)]
    pub right: bool,
    #[serde(default)]
    pub bottom: bool,
    #[serde(default)]
    pub left: bool,
}

impl DockEdges {
    pub const NONE: Self = Self {
        top: false,
        right: false,
        bottom: false,
        left: false,
    };

    pub fn any(self) -> bool {
        self.top || self.right || self.bottom || self.left
    }

    pub fn is_floating(self) -> bool {
        !self.any()
    }

    pub fn edges_added(self, prev: Self) -> Self {
        Self {
            top: self.top && !prev.top,
            right: self.right && !prev.right,
            bottom: self.bottom && !prev.bottom,
            left: self.left && !prev.left,
        }
    }

    pub fn edges_removed(self, prev: Self) -> Self {
        Self {
            top: !self.top && prev.top,
            right: !self.right && prev.right,
            bottom: !self.bottom && prev.bottom,
            left: !self.left && prev.left,
        }
    }
}

/// Native macOS glass bleed past each window edge, in points.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct GlassBleed {
    pub top: f64,
    pub right: f64,
    pub bottom: f64,
    pub left: f64,
}

impl GlassBleed {
    pub const ZERO: Self = Self {
        top: 0.0,
        right: 0.0,
        bottom: 0.0,
        left: 0.0,
    };

    /// Compute glass bleed from dock state and signed pull tension (`-1..=1`).
    /// Matches the CSS corner-roundness curve (`roundness = 0.35 * pull_edge`)
    /// so the native glass peels smoothly in lockstep with CSS border radii.
    pub fn from_dock(dock: DockEdges, pull_x: f64, pull_y: f64) -> Self {
        let edge_bleed = |docked: bool, pull_away: f64| -> f64 {
            if !docked {
                return 0.0;
            }
            let roundness = 0.35 * pull_away.clamp(0.0, 1.0);
            MARQUEE_RADIUS * (1.0 - roundness)
        };
        Self {
            top: edge_bleed(dock.top, pull_y.max(0.0)),
            bottom: edge_bleed(dock.bottom, (-pull_y).max(0.0)),
            left: edge_bleed(dock.left, pull_x.max(0.0)),
            right: edge_bleed(dock.right, (-pull_x).max(0.0)),
        }
    }
}

/// Discrete attach or detach event emitted on dock state transitions.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DockImpulse {
    AttachTop,
    AttachBottom,
    AttachLeft,
    AttachRight,
    DetachTop,
    DetachBottom,
    DetachLeft,
    DetachRight,
}

/// Live drag surface-tension & momentum impulse sent to the Marquee WebView.
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
pub struct MarqueeDragFeedback {
    pub pull_x: f64,
    pub pull_y: f64,
    pub impulse: Option<DockImpulse>,
}

/// The notch on a MacBook display, in points from the display's left edge.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Notch {
    pub left: f64,
    pub right: f64,
    pub height: f64,
}

/// What [`marquee_frame`] needs to know about the display.
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
    /// Which screen edges the Marquee is docked to.
    pub dock: DockEdges,
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
            scale: ui.marquee_scale,
            base_width: ui.marquee_base_width,
            lines: ui.marquee_lines,
        }
    }
}

/// The Marquee's size and dock state on its current display. The frontend
/// scales its layout by `scale`, pads its content by `notch_inset`, and adapts
/// its corner radii & alignment from `dock`.
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
pub struct MarqueeFrame {
    pub scale: f32,
    /// `scale` was matched to the display rather than chosen.
    pub auto_scale: bool,
    pub width: u32,
    pub height: u32,
    /// Extra height at the top that sits behind the notch, in points.
    pub notch_inset: u32,
    /// True whenever at least one edge is attached.
    pub docked: bool,
    /// Exact screen edges attached.
    pub dock: DockEdges,
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

pub fn marquee_frame(prefs: SizePrefs, display: Display, placement: Placement) -> MarqueeFrame {
    frame_with_center(prefs, display, placement.dock, |_| placement.center_x)
}

fn size_scale(prefs: SizePrefs, display: Display) -> f32 {
    match prefs.scale {
        Some(scale) if scale.is_finite() => nearest_step(scale),
        _ => auto_scale(display.work_area_width),
    }
}

fn display_max_width(display: Display) -> f64 {
    (display.work_area_width * MAX_WORK_AREA_SHARE).max(MIN_WIDTH)
}

fn frame_with_center(
    prefs: SizePrefs,
    display: Display,
    dock: DockEdges,
    center_for_width: impl FnOnce(f64) -> f64,
) -> MarqueeFrame {
    let scale = size_scale(prefs, display);
    let base_width = prefs.base_width.clamp(MIN_BASE_WIDTH, MAX_BASE_WIDTH);
    let max_width = display_max_width(display);

    let mut width = (f64::from(base_width) * f64::from(scale)).min(max_width);
    let mut height = base_height(prefs.lines) * f64::from(scale);
    let mut notch_inset = 0.0;

    if let Some(notch) = display.notch.filter(|_| dock.top) {
        let half = width / 2.0;
        let center = center_for_width(width);
        let overlaps = center - half < notch.right && center + half > notch.left;
        if overlaps {
            notch_inset = notch.height.ceil();
            height += notch_inset;
            width = width.max(notch.right - notch.left + 2.0 * NOTCH_SIDE_ROOM);
        }
    }

    MarqueeFrame {
        scale,
        auto_scale: prefs.scale.is_none(),
        width: width.round() as u32,
        height: height.round() as u32,
        notch_inset: notch_inset as u32,
        docked: dock.any(),
        dock,
        max_width: max_width.floor() as u32,
    }
}

#[derive(Clone, Copy, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ResizeEdge {
    Left,
    Right,
}

impl ResizeEdge {
    fn origin(self, anchor: f64, width: f64) -> f64 {
        match self {
            Self::Left => anchor - width,
            Self::Right => anchor,
        }
    }
}

fn resize_frame(
    mut prefs: SizePrefs,
    display: Display,
    dock: DockEdges,
    width: f64,
    edge: ResizeEdge,
    anchor: f64,
    room: f64,
) -> (MarqueeFrame, u32, f64) {
    let scale = f64::from(size_scale(prefs, display));
    let available_base_width = ((room.floor() + 0.5) / scale).ceil() as u32;
    let max_base_width = available_base_width
        .saturating_sub(1)
        .clamp(MIN_BASE_WIDTH, MAX_BASE_WIDTH);
    prefs.base_width = ((width.min(display_max_width(display)) / scale).round() as u32)
        .clamp(MIN_BASE_WIDTH, max_base_width);
    let frame = frame_with_center(prefs, display, dock, |width| {
        edge.origin(anchor, width) + width / 2.0
    });
    (
        frame,
        prefs.base_width,
        edge.origin(anchor, f64::from(frame.width)),
    )
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
/// display's top-left corner, unless it is docked against a screen edge.
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
    /// in the upper half, above one in the lower half. Edge docking is
    /// unaffected.
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

    fn center_y(&self) -> f64 {
        (self.top + self.bottom) / 2.0
    }
}

/// Full display bounds in points from its top-left corner, keeping OS work
/// insets separate from Karaoke avoidance so bottom/side dock triggers always
/// measure the real Dock/taskbar inset.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct DisplayBounds {
    pub width: f64,
    pub height: f64,
    /// OS work area (without Karaoke avoidance).
    pub work_safe: SafeArea,
    /// Safe area for floating panels (with Karaoke avoidance).
    pub float_safe: SafeArea,
    pub notch: Option<Notch>,
}

impl DisplayBounds {
    pub fn new(
        width: f64,
        height: f64,
        work_safe: SafeArea,
        float_safe: SafeArea,
        notch: Option<Notch>,
    ) -> Self {
        Self {
            width,
            height,
            work_safe,
            float_safe,
            notch,
        }
    }

    #[cfg(test)]
    pub fn from_safe(width: f64, height: f64, safe: SafeArea, notch: Option<Notch>) -> Self {
        Self::new(width, height, safe, safe, notch)
    }

    fn top_inset(&self) -> f64 {
        self.work_safe.top.max(0.0)
    }

    fn bottom_inset(&self) -> f64 {
        (self.height - self.work_safe.bottom).max(0.0)
    }

    fn left_inset(&self) -> f64 {
        self.work_safe.left.max(0.0)
    }

    fn right_inset(&self) -> f64 {
        (self.width - self.work_safe.right).max(0.0)
    }

    pub fn top_dock_line(&self, live_drag: bool) -> f64 {
        let inset = self.top_inset();
        if inset > 0.0 {
            inset / 2.0
        } else if live_drag {
            ZERO_INSET_LIVE_TRIGGER_PT
        } else {
            0.0
        }
    }

    pub fn bottom_dock_line(&self, live_drag: bool) -> f64 {
        let inset = self.bottom_inset();
        if inset > 0.0 {
            self.work_safe.bottom + inset / 2.0
        } else if live_drag {
            self.height - ZERO_INSET_LIVE_TRIGGER_PT
        } else {
            self.height
        }
    }

    pub fn left_dock_line(&self, live_drag: bool) -> f64 {
        let inset = self.left_inset();
        if inset > 0.0 {
            inset / 2.0
        } else if live_drag {
            ZERO_INSET_LIVE_TRIGGER_PT
        } else {
            0.0
        }
    }

    pub fn right_dock_line(&self, live_drag: bool) -> f64 {
        let inset = self.right_inset();
        if inset > 0.0 {
            self.work_safe.right + inset / 2.0
        } else if live_drag {
            self.width - ZERO_INSET_LIVE_TRIGGER_PT
        } else {
            self.width
        }
    }

    pub fn display(&self) -> Display {
        Display {
            work_area_width: (self.work_safe.right - self.work_safe.left).max(0.0),
            notch: self.notch,
        }
    }
}

/// Top-left corner (points) of a `width` × `height` Marquee the user has not
/// placed: centred, a margin above the bottom of the safe area. Never docked,
/// so it never starts under a notch or against a screen edge.
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

/// Settle a Marquee at `(x, y)` inside `bounds`, returning the settled top-left
/// corner and resolved [`DockEdges`]. When `active_dock` is given (live drag or
/// restored `marquee_dock`), those attached edges stay pinned flush; otherwise
/// edges pushed past their dock lines attach flush to the physical display.
pub fn settle_placement(
    bounds: DisplayBounds,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    active_dock: Option<DockEdges>,
    snap_to_guides: bool,
) -> ((f64, f64), DockEdges) {
    let mut dock = DockEdges::NONE;
    let active = active_dock.unwrap_or(DockEdges::NONE);

    // Resolve horizontal dock first so side-docked vertical snapping can include
    // vertical screen centering.
    let dock_left = active.left || (!active.right && x <= bounds.left_dock_line(false));
    let dock_right =
        !dock_left && (active.right || x + width >= bounds.right_dock_line(false));

    let settled_x = if dock_left {
        dock.left = true;
        0.0
    } else if dock_right {
        dock.right = true;
        (bounds.width - width).max(0.0)
    } else {
        let contained = contain(bounds.float_safe.left, bounds.float_safe.right, x, width);
        if snap_to_guides {
            let snapped = snap(
                contained,
                &[
                    bounds.float_safe.left + EDGE_MARGIN,
                    bounds.float_safe.center_x() - width / 2.0,
                    bounds.float_safe.right - EDGE_MARGIN - width,
                ],
            );
            contain(
                bounds.float_safe.left,
                bounds.float_safe.right,
                snapped,
                width,
            )
        } else {
            contained
        }
    };

    let dock_top = active.top || (!active.bottom && y <= bounds.top_dock_line(false));
    let dock_bottom =
        !dock_top && (active.bottom || y + height >= bounds.bottom_dock_line(false));

    let settled_y = if dock_top {
        dock.top = true;
        0.0
    } else if dock_bottom {
        dock.bottom = true;
        (bounds.height - height).max(0.0)
    } else {
        let contained = contain(bounds.float_safe.top, bounds.float_safe.bottom, y, height);
        if snap_to_guides {
            let side_docked = dock.left || dock.right;
            let targets: Vec<f64> = if side_docked {
                vec![
                    bounds.float_safe.top + EDGE_MARGIN,
                    bounds.float_safe.center_y() - height / 2.0,
                    bounds.float_safe.bottom - EDGE_MARGIN - height,
                ]
            } else {
                vec![
                    bounds.float_safe.top + EDGE_MARGIN,
                    bounds.float_safe.bottom - EDGE_MARGIN - height,
                ]
            };
            let snapped = snap(contained, &targets);
            contain(
                bounds.float_safe.top,
                bounds.float_safe.bottom,
                snapped,
                height,
            )
        } else {
            contained
        }
    };

    ((settled_x, settled_y), dock)
}

/// Top-left corner (points) after a Marquee at `(x, y)` changes size from
/// `old` to `new`, keeping any docked edges pinned flush and keeping the
/// centre / nearer floating edges steady.
pub fn refit_placement(
    bounds: DisplayBounds,
    x: f64,
    y: f64,
    old: (f64, f64),
    new: (f64, f64),
    dock: DockEdges,
) -> ((f64, f64), DockEdges) {
    let nx = if dock.left {
        0.0
    } else if dock.right {
        (bounds.width - new.0).max(0.0)
    } else {
        x + (old.0 - new.0) / 2.0
    };

    let ny = if dock.top {
        0.0
    } else if dock.bottom {
        (bounds.height - new.1).max(0.0)
    } else {
        let room_above = y - bounds.float_safe.top;
        let room_below = bounds.float_safe.bottom - (y + old.1);
        if room_below < room_above {
            y + old.1 - new.1
        } else {
            y
        }
    };

    settle_placement(bounds, nx, ny, new.0, new.1, Some(dock), false)
}

/// Convenience wrapper for single-safe-area callers/tests.
#[cfg(test)]
pub fn settle_origin(area: SafeArea, x: f64, y: f64, width: f64, height: f64) -> (f64, f64) {
    let bounds = DisplayBounds::from_safe(area.right + area.left, area.bottom, area, None);
    settle_placement(bounds, x, y, width, height, None, true).0
}

/// Convenience wrapper for single-safe-area callers/tests.
#[cfg(test)]
pub fn refit_origin(
    area: SafeArea,
    x: f64,
    y: f64,
    old: (f64, f64),
    new: (f64, f64),
) -> (f64, f64) {
    let bounds = DisplayBounds::from_safe(area.right + area.left, area.bottom, area, None);
    let dock = DockEdges {
        top: y.abs() < 0.5,
        ..DockEdges::NONE
    };
    refit_placement(bounds, x, y, old, new, dock).0
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

// ── Liquid Drag Physics & Spring Engine ───────────────────────────────────────

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct AdjacentMonitors {
    pub top: bool,
    pub right: bool,
    pub bottom: bool,
    pub left: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ScreenEdge {
    Top,
    Right,
    Bottom,
    Left,
}

#[derive(Clone, Debug, PartialEq)]
pub struct LiquidDragStep {
    pub dock: DockEdges,
    pub target_x: f64,
    pub target_y: f64,
    pub pull_x: f64,
    pub pull_y: f64,
    pub suppress: DockEdges,
    pub cross_edge: Option<ScreenEdge>,
    pub impulses: Vec<DockImpulse>,
}

/// Pure orthogonal liquid drag state machine across all 4 screen edges and 4
/// corners. While attached, pulling away inside `BREAKAWAY_PX` keeps the window
/// glued flush to the edge while ramping pull tension (`-1..=1`); crossing
/// `BREAKAWAY_PX` snaps off cleanly. Crossing an adjacent monitor border holds a
/// brief `MULTI_MONITOR_BREAKAWAY_PX` detent, then releases smoothly onto the
/// neighbouring display.
pub fn evaluate_liquid_drag(
    bounds: DisplayBounds,
    adjacent: AdjacentMonitors,
    mut suppress: DockEdges,
    prev_dock: DockEdges,
    raw_x: f64,
    raw_y: f64,
    width: f64,
    height: f64,
) -> LiquidDragStep {
    if suppress.top && raw_y > bounds.work_safe.top + ENTRY_SUPPRESS_CLEARANCE_PT {
        suppress.top = false;
    }
    if suppress.bottom
        && (raw_y + height) < bounds.work_safe.bottom - ENTRY_SUPPRESS_CLEARANCE_PT
    {
        suppress.bottom = false;
    }
    if suppress.left && raw_x > bounds.work_safe.left + ENTRY_SUPPRESS_CLEARANCE_PT {
        suppress.left = false;
    }
    if suppress.right
        && (raw_x + width) < bounds.work_safe.right - ENTRY_SUPPRESS_CLEARANCE_PT
    {
        suppress.right = false;
    }

    let mut dock = DockEdges::NONE;
    let mut impulses = Vec::with_capacity(2);
    let mut cross_edge = None;

    // ── Horizontal axis ───────────────────────────────────────────────────
    let max_x = (bounds.width - width).max(0.0);
    let left_trigger = bounds.left_dock_line(true);
    let right_trigger = bounds.right_dock_line(true);

    let (target_x, pull_x) = if prev_dock.left {
        let pull = raw_x;
        if pull < 0.0 {
            if adjacent.left && -pull >= MULTI_MONITOR_BREAKAWAY_PX {
                cross_edge = Some(ScreenEdge::Left);
                (raw_x, 0.0)
            } else {
                dock.left = true;
                (0.0, 0.0)
            }
        } else if pull < BREAKAWAY_PX {
            dock.left = true;
            (0.0, (pull / BREAKAWAY_PX).clamp(0.0, 1.0))
        } else {
            impulses.push(DockImpulse::DetachLeft);
            (raw_x, 0.0)
        }
    } else if prev_dock.right {
        let pull = max_x - raw_x;
        if pull < 0.0 {
            if adjacent.right && -pull >= MULTI_MONITOR_BREAKAWAY_PX {
                cross_edge = Some(ScreenEdge::Right);
                (raw_x, 0.0)
            } else {
                dock.right = true;
                (max_x, 0.0)
            }
        } else if pull < BREAKAWAY_PX {
            dock.right = true;
            (max_x, -(pull / BREAKAWAY_PX).clamp(0.0, 1.0))
        } else {
            impulses.push(DockImpulse::DetachRight);
            (raw_x, 0.0)
        }
    } else if !suppress.left && raw_x <= left_trigger {
        if adjacent.left && raw_x <= -MULTI_MONITOR_BREAKAWAY_PX {
            cross_edge = Some(ScreenEdge::Left);
            (raw_x, 0.0)
        } else {
            dock.left = true;
            impulses.push(DockImpulse::AttachLeft);
            (0.0, 0.0)
        }
    } else if !suppress.right && (raw_x + width) >= right_trigger {
        if adjacent.right && (raw_x + width) >= bounds.width + MULTI_MONITOR_BREAKAWAY_PX {
            cross_edge = Some(ScreenEdge::Right);
            (raw_x, 0.0)
        } else {
            dock.right = true;
            impulses.push(DockImpulse::AttachRight);
            (max_x, 0.0)
        }
    } else {
        let x = if (adjacent.left && raw_x < 0.0) || (adjacent.right && raw_x > max_x) {
            raw_x
        } else {
            raw_x.clamp(0.0, max_x)
        };
        (x, 0.0)
    };

    // ── Vertical axis ─────────────────────────────────────────────────────
    let max_y = (bounds.height - height).max(0.0);
    let top_trigger = bounds.top_dock_line(true);
    let bottom_trigger = bounds.bottom_dock_line(true);

    let (target_y, pull_y) = if prev_dock.top {
        let pull = raw_y;
        if pull < 0.0 {
            if adjacent.top && -pull >= MULTI_MONITOR_BREAKAWAY_PX {
                cross_edge.get_or_insert(ScreenEdge::Top);
                (raw_y, 0.0)
            } else {
                dock.top = true;
                (0.0, 0.0)
            }
        } else if pull < BREAKAWAY_PX {
            dock.top = true;
            (0.0, (pull / BREAKAWAY_PX).clamp(0.0, 1.0))
        } else {
            impulses.push(DockImpulse::DetachTop);
            (raw_y, 0.0)
        }
    } else if prev_dock.bottom {
        let pull = max_y - raw_y;
        if pull < 0.0 {
            if adjacent.bottom && -pull >= MULTI_MONITOR_BREAKAWAY_PX {
                cross_edge.get_or_insert(ScreenEdge::Bottom);
                (raw_y, 0.0)
            } else {
                dock.bottom = true;
                (max_y, 0.0)
            }
        } else if pull < BREAKAWAY_PX {
            dock.bottom = true;
            (max_y, -(pull / BREAKAWAY_PX).clamp(0.0, 1.0))
        } else {
            impulses.push(DockImpulse::DetachBottom);
            (raw_y, 0.0)
        }
    } else if !suppress.top && raw_y <= top_trigger {
        if adjacent.top && raw_y <= -MULTI_MONITOR_BREAKAWAY_PX {
            cross_edge.get_or_insert(ScreenEdge::Top);
            (raw_y, 0.0)
        } else {
            dock.top = true;
            impulses.push(DockImpulse::AttachTop);
            (0.0, 0.0)
        }
    } else if !suppress.bottom && (raw_y + height) >= bottom_trigger {
        if adjacent.bottom && (raw_y + height) >= bounds.height + MULTI_MONITOR_BREAKAWAY_PX {
            cross_edge.get_or_insert(ScreenEdge::Bottom);
            (raw_y, 0.0)
        } else {
            dock.bottom = true;
            impulses.push(DockImpulse::AttachBottom);
            (max_y, 0.0)
        }
    } else {
        let y = if (adjacent.top && raw_y < 0.0) || (adjacent.bottom && raw_y > max_y) {
            raw_y
        } else {
            raw_y.clamp(0.0, max_y)
        };
        (y, 0.0)
    };

    LiquidDragStep {
        dock,
        target_x,
        target_y,
        pull_x,
        pull_y,
        suppress,
        cross_edge,
        impulses,
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Spring1D {
    pub val: f64,
    pub vel: f64,
}

impl Spring1D {
    pub fn new(val: f64) -> Self {
        Self { val, vel: 0.0 }
    }

    pub fn snap(&mut self, target: f64) {
        self.val = target;
        self.vel = 0.0;
    }

    pub fn is_settled(&self, target: f64) -> bool {
        (self.val - target).abs() < 0.25 && self.vel.abs() < 1.0
    }

    pub fn step(&mut self, target: f64, stiffness: f64, damping: f64, dt: f64) {
        let dt = dt.clamp(0.0, 0.033);
        if dt <= 0.0 {
            return;
        }
        let max_substep = 0.004;
        let steps = (dt / max_substep).ceil().max(1.0) as usize;
        let sub_dt = dt / (steps as f64);
        for _ in 0..steps {
            let accel = -stiffness * (self.val - target) - damping * self.vel;
            self.vel += accel * sub_dt;
            self.val += self.vel * sub_dt;
        }
        if self.is_settled(target) {
            self.snap(target);
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SpringPreset {
    Attach,
    Chase,
}

impl SpringPreset {
    fn params(self) -> ((f64, f64), (f64, f64), (f64, f64)) {
        match self {
            // Critically damped crisp settle (~230ms arrival) without bounce.
            Self::Attach => ((420.0, 38.0), (440.0, 40.0), (460.0, 40.0)),
            // Snappier catch-up after breakaway (~160ms).
            Self::Chase => ((580.0, 44.0), (480.0, 42.0), (460.0, 40.0)),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SpringTarget {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub bleed: GlassBleed,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FrameSpring {
    pub x: Spring1D,
    pub y: Spring1D,
    pub w: Spring1D,
    pub h: Spring1D,
    pub bleed_top: Spring1D,
    pub bleed_right: Spring1D,
    pub bleed_bottom: Spring1D,
    pub bleed_left: Spring1D,
}

impl FrameSpring {
    pub fn at(target: SpringTarget) -> Self {
        Self {
            x: Spring1D::new(target.x),
            y: Spring1D::new(target.y),
            w: Spring1D::new(target.w),
            h: Spring1D::new(target.h),
            bleed_top: Spring1D::new(target.bleed.top),
            bleed_right: Spring1D::new(target.bleed.right),
            bleed_bottom: Spring1D::new(target.bleed.bottom),
            bleed_left: Spring1D::new(target.bleed.left),
        }
    }

    pub fn snap_all(&mut self, target: SpringTarget) {
        self.x.snap(target.x);
        self.y.snap(target.y);
        self.w.snap(target.w);
        self.h.snap(target.h);
        self.bleed_top.snap(target.bleed.top);
        self.bleed_right.snap(target.bleed.right);
        self.bleed_bottom.snap(target.bleed.bottom);
        self.bleed_left.snap(target.bleed.left);
    }

    pub fn step(&mut self, target: SpringTarget, preset: SpringPreset, dt: f64) {
        let ((pk, pd), (sk, sd), (bk, bd)) = preset.params();
        self.x.step(target.x, pk, pd, dt);
        self.y.step(target.y, pk, pd, dt);
        self.w.step(target.w, sk, sd, dt);
        self.h.step(target.h, sk, sd, dt);
        self.bleed_top.step(target.bleed.top, bk, bd, dt);
        self.bleed_right.step(target.bleed.right, bk, bd, dt);
        self.bleed_bottom.step(target.bleed.bottom, bk, bd, dt);
        self.bleed_left.step(target.bleed.left, bk, bd, dt);
    }

    pub fn is_settled(&self, target: SpringTarget) -> bool {
        self.x.is_settled(target.x)
            && self.y.is_settled(target.y)
            && self.w.is_settled(target.w)
            && self.h.is_settled(target.h)
            && self.bleed_top.is_settled(target.bleed.top)
            && self.bleed_right.is_settled(target.bleed.right)
            && self.bleed_bottom.is_settled(target.bleed.bottom)
            && self.bleed_left.is_settled(target.bleed.left)
    }

    pub fn bleed(&self) -> GlassBleed {
        GlassBleed {
            top: self.bleed_top.val.max(0.0),
            right: self.bleed_right.val.max(0.0),
            bottom: self.bleed_bottom.val.max(0.0),
            left: self.bleed_left.val.max(0.0),
        }
    }
}

// ── Host ──────────────────────────────────────────────────────────────────────

#[derive(Clone)]
struct ScreenInfo {
    monitor: tauri::Monitor,
    bounds: DisplayBounds,
    /// Global monitor origin/size (points on macOS, physical pixels elsewhere).
    global_x: f64,
    global_y: f64,
    global_w: f64,
    global_h: f64,
    /// Global Y-down logical origin for macOS `apply_marquee_frame`.
    screen_origin_pt: (f64, f64),
    sf: f64,
    unit_scale: f64,
}

impl ScreenInfo {
    fn global_to_local(&self, gx: f64, gy: f64) -> (f64, f64) {
        (
            (gx - self.global_x) / self.unit_scale,
            (gy - self.global_y) / self.unit_scale,
        )
    }

    fn phys_origin(&self, lx: f64, ly: f64) -> (i32, i32) {
        (
            self.monitor.position().x + (lx * self.sf).round() as i32,
            self.monitor.position().y + (ly * self.sf).round() as i32,
        )
    }
}

struct DragSession {
    start_global_x: f64,
    start_global_y: f64,
    start_mouse_pt: Option<(f64, f64)>,
    used_native_mouse: bool,
    native_minus_dom: (f64, f64),
    start_sf: f64,
    active_screen_idx: usize,
    dock: DockEdges,
    suppress: DockEdges,
    last_feedback: (i32, i32),
    rebase_x: f64,
    rebase_y: f64,
    last_notch_inset: u32,
    straddling: bool,
}

struct AnimatorState {
    generation: u64,
    running: bool,
    preset: SpringPreset,
    spring: FrameSpring,
    target: SpringTarget,
    screen: Option<ScreenInfo>,
    dock: DockEdges,
    last_step: Instant,
    tick_pending: Arc<AtomicBool>,
}

impl Default for AnimatorState {
    fn default() -> Self {
        let zero = SpringTarget {
            x: 0.0,
            y: 0.0,
            w: f64::from(DEFAULT_BASE_WIDTH),
            h: TWO_LINE_HEIGHT,
            bleed: GlassBleed::ZERO,
        };
        Self {
            generation: 0,
            running: false,
            preset: SpringPreset::Attach,
            spring: FrameSpring::at(zero),
            target: zero,
            screen: None,
            dock: DockEdges::NONE,
            last_step: Instant::now(),
            tick_pending: Arc::new(AtomicBool::new(false)),
        }
    }
}

/// Host state for Marquee sizing, multi-edge docking, liquid drag, and spring
/// settle animations.
#[derive(Default)]
pub struct MarqueeFit {
    frame: Mutex<Option<MarqueeFrame>>,
    resizing: AtomicBool,
    dragging: AtomicBool,
    animating: AtomicBool,
    generation: AtomicU64,
    drag: Mutex<Option<DragSession>>,
    animator: Mutex<AnimatorState>,
}

impl MarqueeFit {
    pub fn current(&self) -> Option<MarqueeFrame> {
        *self.frame.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// True while dragging, edge-resizing, or running a spring animation.
    fn is_busy(&self) -> bool {
        self.resizing.load(Ordering::Relaxed)
            || self.dragging.load(Ordering::Relaxed)
            || self.animating.load(Ordering::Relaxed)
    }

    /// Store `frame`, returning whether it differs from the last one.
    fn replace(&self, frame: MarqueeFrame) -> bool {
        let mut slot = self.frame.lock().unwrap_or_else(|e| e.into_inner());
        let changed = *slot != Some(frame);
        *slot = Some(frame);
        changed
    }

    fn bump_generation(&self) -> u64 {
        self.generation.fetch_add(1, Ordering::AcqRel) + 1
    }
}

/// A display that can't be measured is sized like a common desktop monitor.
const UNMEASURED_WORK_AREA_WIDTH: f64 = 1920.0;

/// The display the Marquee is on, or the primary display when it is on none.
fn marquee_monitor(window: &tauri::WebviewWindow) -> Option<tauri::Monitor> {
    window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| window.primary_monitor().ok().flatten())
}

fn display_for(window: &tauri::WebviewWindow, monitor: Option<&tauri::Monitor>) -> Display {
    Display {
        work_area_width: monitor.map_or(UNMEASURED_WORK_AREA_WIDTH, |m| {
            f64::from(m.work_area().size.width) / m.scale_factor()
        }),
        notch: crate::macos::display_notch(window),
    }
}

fn build_screen_info(
    app: &AppHandle,
    monitor: &tauri::Monitor,
    mac_screens: &[crate::macos::MacScreen],
) -> ScreenInfo {
    let sf = monitor.scale_factor().max(0.5);
    let mon_x_pt = f64::from(monitor.position().x) / sf;
    let mon_y_pt = f64::from(monitor.position().y) / sf;
    let mon_w_pt = f64::from(monitor.size().width) / sf;
    let mon_h_pt = f64::from(monitor.size().height) / sf;

    let mac_match = mac_screens.iter().find(|s| {
        (s.x - mon_x_pt).abs() < 2.0
            && (s.y - mon_y_pt).abs() < 2.0
            && (s.width - mon_w_pt).abs() < 2.0
    });

    let (width, height, work_left, work_top, work_w, work_h, notch, screen_origin_pt) =
        if let Some(s) = mac_match {
            (
                s.width,
                s.height,
                s.work_left,
                s.work_top,
                s.work_right - s.work_left,
                s.work_bottom - s.work_top,
                s.notch,
                (s.x, s.y),
            )
        } else {
            let work = monitor.work_area();
            (
                mon_w_pt,
                mon_h_pt,
                f64::from(work.position.x - monitor.position().x) / sf,
                f64::from(work.position.y - monitor.position().y) / sf,
                f64::from(work.size.width) / sf,
                f64::from(work.size.height) / sf,
                None,
                (mon_x_pt, mon_y_pt),
            )
        };

    let top_inset = notch.map_or(0.0, |n| n.height);
    let work_safe = SafeArea::new(work_left, work_top, work_w, work_h, top_inset);
    let float_safe = match karaoke_band(app, monitor) {
        Some((top, bottom)) => work_safe.clear_of(top, bottom),
        None => work_safe,
    };

    let is_mac = !mac_screens.is_empty();
    let (global_x, global_y, global_w, global_h, unit_scale) = if is_mac {
        (screen_origin_pt.0, screen_origin_pt.1, width, height, 1.0)
    } else {
        (
            f64::from(monitor.position().x),
            f64::from(monitor.position().y),
            f64::from(monitor.size().width),
            f64::from(monitor.size().height),
            sf,
        )
    };

    ScreenInfo {
        monitor: monitor.clone(),
        bounds: DisplayBounds::new(width, height, work_safe, float_safe, notch),
        global_x,
        global_y,
        global_w,
        global_h,
        screen_origin_pt,
        sf,
        unit_scale,
    }
}

fn collect_screens(app: &AppHandle, window: &tauri::WebviewWindow) -> Vec<ScreenInfo> {
    let mac_screens = crate::macos::macos_screens();
    let Ok(monitors) = window.available_monitors() else {
        return Vec::new();
    };
    monitors
        .iter()
        .map(|m| build_screen_info(app, m, &mac_screens))
        .collect()
}

fn screen_for_monitor(
    app: &AppHandle,
    _window: &tauri::WebviewWindow,
    monitor: &tauri::Monitor,
) -> ScreenInfo {
    let mac_screens = crate::macos::macos_screens();
    build_screen_info(app, monitor, &mac_screens)
}

fn adjacent_monitors(screens: &[ScreenInfo], idx: usize) -> AdjacentMonitors {
    let Some(s) = screens.get(idx) else {
        return AdjacentMonitors::default();
    };
    let tol = 4.0 * s.unit_scale;
    let mut adj = AdjacentMonitors::default();
    for (j, o) in screens.iter().enumerate() {
        if j == idx {
            continue;
        }
        let overlap_y = s.global_y < o.global_y + o.global_h && o.global_y < s.global_y + s.global_h;
        let overlap_x = s.global_x < o.global_x + o.global_w && o.global_x < s.global_x + s.global_w;
        if overlap_y && (o.global_x + o.global_w - s.global_x).abs() <= tol {
            adj.left = true;
        }
        if overlap_y && (s.global_x + s.global_w - o.global_x).abs() <= tol {
            adj.right = true;
        }
        if overlap_x && (o.global_y + o.global_h - s.global_y).abs() <= tol {
            adj.top = true;
        }
        if overlap_x && (s.global_y + s.global_h - o.global_y).abs() <= tol {
            adj.bottom = true;
        }
    }
    adj
}

fn screen_index_for_point(screens: &[ScreenInfo], gx: f64, gy: f64) -> Option<usize> {
    screens
        .iter()
        .position(|s| {
            gx >= s.global_x
                && gx < s.global_x + s.global_w
                && gy >= s.global_y
                && gy < s.global_y + s.global_h
        })
        .or_else(|| {
            screens
                .iter()
                .enumerate()
                .min_by(|(_, a), (_, b)| {
                    let da = dist_to_rect(gx, gy, a.global_x, a.global_y, a.global_w, a.global_h);
                    let db = dist_to_rect(gx, gy, b.global_x, b.global_y, b.global_w, b.global_h);
                    da.total_cmp(&db)
                })
                .map(|(i, _)| i)
        })
}

fn dist_to_rect(x: f64, y: f64, rx: f64, ry: f64, rw: f64, rh: f64) -> f64 {
    let dx = (rx - x).max(0.0).max(x - (rx + rw));
    let dy = (ry - y).max(0.0).max(y - (ry + rh));
    dx * dx + dy * dy
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
    let position = window_position(&window)?;
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

/// Where the window is, in physical pixels. `None` when the window system
/// doesn't say: a native Wayland client is told nothing about its position
/// (the toolkit then reports the origin, which is not a real place).
fn window_position(window: &tauri::WebviewWindow) -> Option<tauri::PhysicalPosition<i32>> {
    if crate::linux::native_wayland() {
        return None;
    }
    window.outer_position().ok()
}

/// The window's top-left corner in points from `monitor`'s top-left corner.
fn origin_on(window: &tauri::WebviewWindow, monitor: &tauri::Monitor) -> Option<(f64, f64)> {
    let position = window_position(window)?;
    let sf = monitor.scale_factor();
    Some((
        f64::from(position.x - monitor.position().x) / sf,
        f64::from(position.y - monitor.position().y) / sf,
    ))
}

/// Window origin and size in `screen`'s local points, preferring AppKit's live
/// frame on macOS so unclamped coordinates (menu bar / Dock overlap) are exact.
fn current_local_frame(
    window: &tauri::WebviewWindow,
    screen: &ScreenInfo,
) -> Option<(f64, f64, f64, f64)> {
    if let Some((gx, gy, w, h)) = crate::macos::marquee_frame_global_pt(window) {
        let (lx, ly) = screen.global_to_local(gx, gy);
        return Some((lx, ly, w, h));
    }
    let (lx, ly) = origin_on(window, &screen.monitor)?;
    let (w, h) = window_points(window)?;
    Some((lx, ly, w, h))
}

/// Apply frame, position, and glass bleed atomically on `screen`.
fn apply_to_screen(
    app: &AppHandle,
    window: &tauri::WebviewWindow,
    screen: &ScreenInfo,
    local_origin: (f64, f64),
    size_pt: (f64, f64),
    bleed: GlassBleed,
    dock: DockEdges,
) -> (i32, i32) {
    let phys = screen.phys_origin(local_origin.0, local_origin.1);
    let _ = crate::macos::apply_marquee_frame(
        app,
        window,
        screen.screen_origin_pt,
        local_origin,
        phys,
        size_pt,
        bleed,
        dock,
        screen.bounds,
    );
    phys
}

/// Save `position` and `dock` as the Marquee's place.
fn remember_placement(app: &AppHandle, position: (i32, i32), dock: DockEdges) {
    let new_state = app.state::<AppState>().ui.mutate(|s| {
        s.marquee_pos = Some(position);
        s.marquee_dock = dock;
    });
    let _ = app.emit("ui-settings-changed", new_state);
}

fn emit_drag_feedback(app: &AppHandle, feedback: MarqueeDragFeedback) {
    let _ = app.emit_to(
        tauri::EventTarget::webview_window("marquee"),
        "marquee-drag-feedback",
        feedback,
    );
}

fn emit_marquee_frame(app: &AppHandle, frame: MarqueeFrame) {
    let _ = app.emit("marquee-frame", frame);
}

fn drive_spring_to(
    app: &AppHandle,
    window: &tauri::WebviewWindow,
    screen: ScreenInfo,
    target: SpringTarget,
    dock: DockEdges,
    preset: SpringPreset,
    animate: bool,
) {
    let state = app.state::<AppState>();

    if !animate || crate::macos::reduce_motion() {
        let generation = state.marquee_fit.bump_generation();
        {
            let mut anim = state.marquee_fit.animator.lock().unwrap_or_else(|e| e.into_inner());
            anim.generation = generation;
            anim.running = false;
            anim.spring.snap_all(target);
            anim.target = target;
            anim.dock = dock;
            anim.screen = Some(screen.clone());
        }
        state.marquee_fit.animating.store(false, Ordering::Release);
        apply_to_screen(
            app,
            window,
            &screen,
            (target.x, target.y),
            (target.w, target.h),
            target.bleed,
            dock,
        );
        return;
    }

    let should_spawn;
    let generation;
    let tick_pending;
    {
        let mut anim = state.marquee_fit.animator.lock().unwrap_or_else(|e| e.into_inner());
        let was_running = anim.running;
        let prev_screen = anim.screen.clone();
        let same_screen = prev_screen
            .as_ref()
            .is_some_and(|prev| prev.monitor.position() == screen.monitor.position());

        if was_running && !same_screen {
            if let Some(prev) = prev_screen.as_ref() {
                let gx = prev.global_x + anim.spring.x.val * prev.unit_scale;
                let gy = prev.global_y + anim.spring.y.val * prev.unit_scale;
                let (lx, ly) = screen.global_to_local(gx, gy);
                let ratio = prev.unit_scale / screen.unit_scale;
                anim.spring.x.val = lx;
                anim.spring.y.val = ly;
                anim.spring.x.vel *= ratio;
                anim.spring.y.vel *= ratio;
            }
        } else if !was_running && !same_screen {
            let (lx, ly, lw, lh) = current_local_frame(window, &screen)
                .unwrap_or((target.x, target.y, target.w, target.h));
            anim.spring = FrameSpring::at(SpringTarget {
                x: lx,
                y: ly,
                w: lw,
                h: lh,
                bleed: GlassBleed::from_dock(dock, 0.0, 0.0),
            });
        } else if !was_running && !state.marquee_fit.dragging.load(Ordering::Relaxed) {
            let (lx, ly, lw, lh) = current_local_frame(window, &screen)
                .unwrap_or((target.x, target.y, target.w, target.h));
            anim.spring.x.snap(lx);
            anim.spring.y.snap(ly);
            anim.spring.w.snap(lw);
            anim.spring.h.snap(lh);
        }

        anim.target = target;
        anim.preset = preset;
        anim.dock = dock;
        anim.screen = Some(screen);
        anim.last_step = Instant::now();
        should_spawn = !was_running;
        if should_spawn {
            generation = state.marquee_fit.bump_generation();
            anim.generation = generation;
            anim.running = true;
        } else {
            generation = anim.generation;
        }
        tick_pending = Arc::clone(&anim.tick_pending);
    }

    state.marquee_fit.animating.store(true, Ordering::Release);
    if !should_spawn {
        return;
    }

    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_millis(8));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            interval.tick().await;
            let Some(state) = app_handle.try_state::<AppState>() else {
                break;
            };
            if state.marquee_fit.generation.load(Ordering::Acquire) != generation {
                break;
            }
            if !state.marquee_fit.animating.load(Ordering::Acquire) {
                break;
            }
            if tick_pending.swap(true, Ordering::AcqRel) {
                continue;
            }
            let inner_app = app_handle.clone();
            let pending_flag = Arc::clone(&tick_pending);
            let scheduled = app_handle.run_on_main_thread(move || {
                pending_flag.store(false, Ordering::Release);
                step_animator_on_main_thread(&inner_app, generation);
            });
            if scheduled.is_err() {
                tick_pending.store(false, Ordering::Release);
                break;
            }
        }
    });
}

fn step_animator_on_main_thread(app: &AppHandle, generation: u64) {
    let state = app.state::<AppState>();
    let Some(window) = app.get_webview_window("marquee") else {
        state.marquee_fit.animating.store(false, Ordering::Release);
        return;
    };

    let (x, y, w, h, bleed, screen, dock, settled) = {
        let mut anim = state.marquee_fit.animator.lock().unwrap_or_else(|e| e.into_inner());
        if !anim.running || anim.generation != generation {
            return;
        }
        let now = Instant::now();
        let dt = now
            .duration_since(anim.last_step)
            .as_secs_f64()
            .clamp(0.001, 0.033);
        anim.last_step = now;
        let target = anim.target;
        let preset = anim.preset;
        anim.spring.step(target, preset, dt);
        let settled = anim.spring.is_settled(target);
        if settled {
            anim.spring.snap_all(target);
            anim.running = false;
        }
        (
            anim.spring.x.val,
            anim.spring.y.val,
            anim.spring.w.val,
            anim.spring.h.val,
            anim.spring.bleed(),
            anim.screen.clone(),
            anim.dock,
            settled,
        )
    };

    if settled {
        state.marquee_fit.animating.store(false, Ordering::Release);
    }
    if let Some(screen) = screen {
        apply_to_screen(app, &window, &screen, (x, y), (w, h), bleed, dock);
    }
}

// ── Live Drag Commands ────────────────────────────────────────────────────────

pub fn begin_marquee_drag(app: &AppHandle) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || begin_marquee_drag_now(&handle));
}

fn begin_marquee_drag_now(app: &AppHandle) {
    let Some(window) = app.get_webview_window("marquee") else {
        return;
    };
    let state = app.state::<AppState>();
    let _gen = state.marquee_fit.bump_generation();
    state.marquee_fit.animating.store(false, Ordering::Release);
    {
        let mut anim = state.marquee_fit.animator.lock().unwrap_or_else(|e| e.into_inner());
        anim.running = false;
    }

    let screens = collect_screens(app, &window);
    if screens.is_empty() {
        return;
    }

    let (start_gx, start_gy, cur_w, cur_h, active_idx) =
        if let Some((gx, gy, w, h)) = crate::macos::marquee_frame_global_pt(&window) {
            let idx = screen_index_for_point(&screens, gx + w / 2.0, gy + h / 2.0).unwrap_or(0);
            (gx, gy, w, h, idx)
        } else if let Some(pos) = window_position(&window) {
            let size = window_points(&window).unwrap_or((f64::from(DEFAULT_BASE_WIDTH), TWO_LINE_HEIGHT));
            let monitor = marquee_monitor(&window);
            let idx = monitor
                .as_ref()
                .and_then(|m| {
                    screens
                        .iter()
                        .position(|s| s.monitor.position() == m.position())
                })
                .unwrap_or(0);
            (f64::from(pos.x), f64::from(pos.y), size.0, size.1, idx)
        } else {
            return;
        };

    let s = &screens[active_idx];
    let (local_x, local_y) = s.global_to_local(start_gx, start_gy);
    let current_frame = state.marquee_fit.current();
    let dock = current_frame
        .map(|f| f.dock)
        .unwrap_or(state.ui.snapshot().marquee_dock);
    let last_notch_inset = current_frame.map_or(0, |f| f.notch_inset);

    let init_target = SpringTarget {
        x: local_x,
        y: local_y,
        w: cur_w,
        h: cur_h,
        bleed: GlassBleed::from_dock(dock, 0.0, 0.0),
    };
    {
        let mut anim = state.marquee_fit.animator.lock().unwrap_or_else(|e| e.into_inner());
        anim.spring = FrameSpring::at(init_target);
        anim.target = init_target;
        anim.dock = dock;
        anim.screen = Some(s.clone());
    }

    let session = DragSession {
        start_global_x: start_gx,
        start_global_y: start_gy,
        start_mouse_pt: crate::macos::macos_mouse_location_y_down(),
        used_native_mouse: false,
        native_minus_dom: (0.0, 0.0),
        start_sf: s.sf,
        active_screen_idx: active_idx,
        dock,
        suppress: DockEdges::NONE,
        last_feedback: (0, 0),
        rebase_x: 0.0,
        rebase_y: 0.0,
        last_notch_inset,
        straddling: false,
    };
    *state.marquee_fit.drag.lock().unwrap_or_else(|e| e.into_inner()) = Some(session);
    state.marquee_fit.dragging.store(true, Ordering::Release);
}

/// Resolve drag displacement in global screen units, keeping pointer baseline
/// continuous on release when native pressed-button tracking drops to `None`.
fn resolve_drag_delta(
    dom_dx: f64,
    dom_dy: f64,
    start_mouse_pt: Option<(f64, f64)>,
    now_pressed_mouse_pt: Option<(f64, f64)>,
    used_native_mouse: &mut bool,
    native_minus_dom: &mut (f64, f64),
) -> (f64, f64) {
    if let (Some(start), Some(now)) = (start_mouse_pt, now_pressed_mouse_pt) {
        let gx = now.0 - start.0;
        let gy = now.1 - start.1;
        *used_native_mouse = true;
        *native_minus_dom = (gx - dom_dx, gy - dom_dy);
        (gx, gy)
    } else if *used_native_mouse {
        (dom_dx + native_minus_dom.0, dom_dy + native_minus_dom.1)
    } else {
        (dom_dx, dom_dy)
    }
}

pub fn move_marquee_drag(app: &AppHandle, dx: f64, dy: f64) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || move_marquee_drag_now(&handle, dx, dy));
}

fn move_marquee_drag_now(app: &AppHandle, dx: f64, dy: f64) {
    let state = app.state::<AppState>();
    let Some(window) = app.get_webview_window("marquee") else {
        return;
    };
    let screens = collect_screens(app, &window);
    if screens.is_empty() {
        return;
    }

    let mut drag_guard = state.marquee_fit.drag.lock().unwrap_or_else(|e| e.into_inner());
    let Some(session) = drag_guard.as_mut() else {
        return;
    };
    if session.active_screen_idx >= screens.len() {
        session.active_screen_idx = 0;
    }

    // On macOS, prefer live AppKit mouseLocation while left button is held so
    // window frame changes never perturb WebKit's event.screenX/Y delta, and
    // preserve the measured baseline offset when the final release event runs.
    let s_unit = screens[session.active_screen_idx].unit_scale;
    let factor = if (s_unit - 1.0).abs() < 0.01 {
        1.0
    } else {
        session.start_sf
    };
    let (delta_gx, delta_gy) = resolve_drag_delta(
        dx * factor,
        dy * factor,
        session.start_mouse_pt,
        crate::macos::macos_pressed_mouse_location_y_down(),
        &mut session.used_native_mouse,
        &mut session.native_minus_dom,
    );

    let raw_gx = session.start_global_x + delta_gx + session.rebase_x;
    let raw_gy = session.start_global_y + delta_gy + session.rebase_y;

    let prefs = SizePrefs::from_ui(&state.ui.snapshot());
    let current_w = state
        .marquee_fit
        .current()
        .map_or(f64::from(DEFAULT_BASE_WIDTH), |f| f64::from(f.width));
    let current_h = state
        .marquee_fit
        .current()
        .map_or(TWO_LINE_HEIGHT, |f| f64::from(f.height));

    // If straddling an adjacent monitor border, update active screen once the
    // panel center crosses into the neighbour.
    if session.straddling {
        let s = &screens[session.active_screen_idx];
        let cx = raw_gx + (current_w * s.unit_scale) / 2.0;
        let cy = raw_gy + (current_h * s.unit_scale) / 2.0;
        if let Some(new_idx) = screen_index_for_point(&screens, cx, cy) {
            if new_idx != session.active_screen_idx {
                session.active_screen_idx = new_idx;
            }
            let ns = &screens[session.active_screen_idx];
            let (lx, ly) = ns.global_to_local(raw_gx, raw_gy);
            if lx >= 0.0
                && lx + current_w <= ns.bounds.width
                && ly >= 0.0
                && ly + current_h <= ns.bounds.height
            {
                session.straddling = false;
            }
        }
    }

    let screen = &screens[session.active_screen_idx];
    let adj = adjacent_monitors(&screens, session.active_screen_idx);
    let (mut local_raw_x, mut local_raw_y) = screen.global_to_local(raw_gx, raw_gy);

    // Prevent raw coordinates from piling up past an outer screen bezel while
    // docked there, so pulling away reacts immediately.
    if session.dock.left && !adj.left && local_raw_x < 0.0 {
        session.rebase_x -= local_raw_x * screen.unit_scale;
        local_raw_x = 0.0;
    }
    if session.dock.right && !adj.right && local_raw_x > screen.bounds.width - current_w {
        let max_x = (screen.bounds.width - current_w).max(0.0);
        session.rebase_x -= (local_raw_x - max_x) * screen.unit_scale;
        local_raw_x = max_x;
    }
    if session.dock.top && !adj.top && local_raw_y < 0.0 {
        session.rebase_y -= local_raw_y * screen.unit_scale;
        local_raw_y = 0.0;
    }
    if session.dock.bottom && !adj.bottom && local_raw_y > screen.bounds.height - current_h {
        let max_y = (screen.bounds.height - current_h).max(0.0);
        session.rebase_y -= (local_raw_y - max_y) * screen.unit_scale;
        local_raw_y = max_y;
    }

    let prev_dock = session.dock;
    let mut step = evaluate_liquid_drag(
        screen.bounds,
        adj,
        session.suppress,
        prev_dock,
        local_raw_x,
        local_raw_y,
        current_w,
        current_h,
    );

    if let Some(edge) = step.cross_edge {
        session.straddling = true;
        match edge {
            ScreenEdge::Left => step.suppress.right = true,
            ScreenEdge::Right => step.suppress.left = true,
            ScreenEdge::Top => step.suppress.bottom = true,
            ScreenEdge::Bottom => step.suppress.top = true,
        }
    }

    // Compute frame for current display and dock state (including live notch
    // expansion when sliding under or out from under a MacBook notch).
    let mut frame = frame_with_center(prefs, screen.bounds.display(), step.dock, |w| {
        if step.dock.left {
            w / 2.0
        } else if step.dock.right {
            screen.bounds.width - w / 2.0
        } else {
            step.target_x + current_w / 2.0
        }
    });

    // Compensate raw_y when leaving a MacBook notch so content stays locked
    // under the user's pointer instead of jumping up by notch_inset.
    if session.last_notch_inset > 0 && frame.notch_inset == 0 && prev_dock.top && !step.dock.top {
        let shift = f64::from(session.last_notch_inset);
        session.rebase_y += shift * screen.unit_scale;
        step.target_y += shift;
    }
    session.last_notch_inset = frame.notch_inset;

    // Re-anchor right/bottom target if notch expansion changed width/height.
    let target_w = f64::from(frame.width);
    let target_h = f64::from(frame.height);
    if step.dock.right {
        step.target_x = (screen.bounds.width - target_w).max(0.0);
    } else if !step.dock.left && (target_w - current_w).abs() >= 0.5 {
        step.target_x += (current_w - target_w) / 2.0;
        if !session.straddling {
            step.target_x = step.target_x.clamp(0.0, (screen.bounds.width - target_w).max(0.0));
        }
    }
    if step.dock.bottom {
        step.target_y = (screen.bounds.height - target_h).max(0.0);
    }
    frame.dock = step.dock;
    frame.docked = step.dock.any();

    session.dock = step.dock;
    session.suppress = step.suppress;

    let bleed = GlassBleed::from_dock(step.dock, step.pull_x, step.pull_y);
    let target = SpringTarget {
        x: step.target_x,
        y: step.target_y,
        w: target_w,
        h: target_h,
        bleed,
    };

    let q_pull = (
        (step.pull_x * 100.0).round() as i32,
        (step.pull_y * 100.0).round() as i32,
    );
    let first_impulse = step.impulses.first().copied();
    if q_pull != session.last_feedback || first_impulse.is_some() {
        session.last_feedback = q_pull;
        for (i, impulse) in step.impulses.iter().enumerate() {
            emit_drag_feedback(
                app,
                MarqueeDragFeedback {
                    pull_x: step.pull_x,
                    pull_y: step.pull_y,
                    impulse: if i == 0 || *impulse != first_impulse.unwrap() {
                        Some(*impulse)
                    } else {
                        None
                    },
                },
            );
        }
        if step.impulses.is_empty() {
            emit_drag_feedback(
                app,
                MarqueeDragFeedback {
                    pull_x: step.pull_x,
                    pull_y: step.pull_y,
                    impulse: None,
                },
            );
        }
    }

    let screen_clone = screen.clone();
    drop(drag_guard);

    if state.marquee_fit.replace(frame) {
        emit_marquee_frame(app, frame);
    }

    let attached_or_detached = step.dock != prev_dock;
    let reduce = crate::macos::reduce_motion();
    let (prev_target_w, prev_target_h) = {
        let anim = state.marquee_fit.animator.lock().unwrap_or_else(|e| e.into_inner());
        (anim.target.w, anim.target.h)
    };
    let size_changed =
        (target.w - prev_target_w).abs() >= 0.5 || (target.h - prev_target_h).abs() >= 0.5;
    let already_running = state.marquee_fit.animating.load(Ordering::Acquire);
    let needs_chase = !reduce && (attached_or_detached || size_changed || already_running);

    if needs_chase {
        let preset = if step.dock.edges_added(prev_dock).any() {
            SpringPreset::Attach
        } else {
            SpringPreset::Chase
        };
        {
            let mut anim = state.marquee_fit.animator.lock().unwrap_or_else(|e| e.into_inner());
            if !already_running {
                let h_changed =
                    step.dock.left != prev_dock.left || step.dock.right != prev_dock.right;
                let v_changed =
                    step.dock.top != prev_dock.top || step.dock.bottom != prev_dock.bottom;
                if !h_changed && !step.dock.left && !step.dock.right {
                    anim.spring.x.snap(target.x);
                }
                if !v_changed && !step.dock.top && !step.dock.bottom {
                    anim.spring.y.snap(target.y);
                }
            }
            // Keep bleed in lockstep during live peel if already docked on that axis.
            if !attached_or_detached {
                anim.spring.bleed_top.snap(bleed.top);
                anim.spring.bleed_right.snap(bleed.right);
                anim.spring.bleed_bottom.snap(bleed.bottom);
                anim.spring.bleed_left.snap(bleed.left);
            }
        }
        drive_spring_to(app, &window, screen_clone, target, step.dock, preset, true);
    } else {
        // Direct 1:1 tracking when free-floating or sliding along a settled edge.
        let generation = state.marquee_fit.bump_generation();
        state.marquee_fit.animating.store(false, Ordering::Release);
        {
            let mut anim = state.marquee_fit.animator.lock().unwrap_or_else(|e| e.into_inner());
            anim.generation = generation;
            anim.running = false;
            anim.spring.snap_all(target);
            anim.target = target;
            anim.dock = step.dock;
            anim.screen = Some(screen_clone.clone());
        }
        apply_to_screen(
            app,
            &window,
            &screen_clone,
            (target.x, target.y),
            (target.w, target.h),
            bleed,
            step.dock,
        );
    }
}

pub fn end_marquee_drag(app: &AppHandle) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || end_marquee_drag_now(&handle));
}

fn end_marquee_drag_now(app: &AppHandle) {
    let state = app.state::<AppState>();
    let session = state
        .marquee_fit
        .drag
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .take();
    state.marquee_fit.dragging.store(false, Ordering::Release);

    let Some(window) = app.get_webview_window("marquee") else {
        return;
    };

    if session.as_ref().is_some_and(|s| s.last_feedback != (0, 0)) {
        emit_drag_feedback(
            app,
            MarqueeDragFeedback {
                pull_x: 0.0,
                pull_y: 0.0,
                impulse: None,
            },
        );
    }

    let screens = collect_screens(app, &window);
    if screens.is_empty() {
        return;
    }

    let (active_dock, screen, cur_x, cur_y, cur_w, cur_h) = if let Some(s_session) = session {
        let anim_target = {
            let anim = state.marquee_fit.animator.lock().unwrap_or_else(|e| e.into_inner());
            anim.target
        };
        let screen = screens
            .get(s_session.active_screen_idx)
            .cloned()
            .unwrap_or_else(|| screens[0].clone());
        (
            Some(s_session.dock),
            screen,
            anim_target.x,
            anim_target.y,
            anim_target.w,
            anim_target.h,
        )
    } else {
        let Some(monitor) = marquee_monitor(&window) else {
            return;
        };
        let screen = screen_for_monitor(app, &window, &monitor);
        let Some((x, y)) = origin_on(&window, &monitor) else {
            return;
        };
        let Some((w, h)) = window_points(&window) else {
            return;
        };
        (None, screen, x, y, w, h)
    };

    let prefs = SizePrefs::from_ui(&state.ui.snapshot());
    let ((mut sx, mut sy), settled_dock) = settle_placement(
        screen.bounds,
        cur_x,
        cur_y,
        cur_w,
        cur_h,
        active_dock,
        true,
    );

    // Recompute frame at settled center/dock (e.g. if snapping aligned under notch).
    let frame = frame_with_center(prefs, screen.bounds.display(), settled_dock, |w| {
        if settled_dock.left {
            w / 2.0
        } else if settled_dock.right {
            screen.bounds.width - w / 2.0
        } else {
            sx + w / 2.0
        }
    });
    let fw = f64::from(frame.width);
    let fh = f64::from(frame.height);
    if (fw - cur_w).abs() >= 0.5 || (fh - cur_h).abs() >= 0.5 {
        let ((rx, ry), _) = settle_placement(
            screen.bounds,
            sx + (cur_w - fw) / 2.0,
            sy,
            fw,
            fh,
            Some(settled_dock),
            true,
        );
        sx = rx;
        sy = ry;
    }

    if state.marquee_fit.replace(frame) {
        emit_marquee_frame(app, frame);
    }

    let settled_phys = screen.phys_origin(sx, sy);
    remember_placement(app, settled_phys, settled_dock);

    let target = SpringTarget {
        x: sx,
        y: sy,
        w: fw,
        h: fh,
        bleed: GlassBleed::from_dock(settled_dock, 0.0, 0.0),
    };
    drive_spring_to(
        app,
        &window,
        screen,
        target,
        settled_dock,
        SpringPreset::Attach,
        true,
    );
}

// ── Edge Resize ───────────────────────────────────────────────────────────────

pub fn resize_marquee(
    app: &AppHandle,
    edge: ResizeEdge,
    anchor_x: Option<i32>,
    width: f64,
    pointer_x: f64,
    done: bool,
) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        let state = handle.state::<AppState>();
        state.marquee_fit.resizing.store(true, Ordering::Relaxed);
        // WebKit can resolve a drag event against a frame that has already
        // moved. Sample the screen pointer while held and use the release
        // event when saving, so later pointer movement cannot change the size.
        let width = if done {
            width
        } else if let Some(x) = crate::macos::marquee_resize_pointer_x() {
            match edge {
                ResizeEdge::Left => width + pointer_x - x,
                ResizeEdge::Right => width + x - pointer_x,
            }
        } else {
            width
        };
        let resized = resize_marquee_now(&handle, edge, anchor_x, width, done);
        if done || resized.is_none() {
            state.marquee_fit.resizing.store(false, Ordering::Relaxed);
        }
    });
}

fn resize_marquee_now(
    app: &AppHandle,
    edge: ResizeEdge,
    anchor_x: Option<i32>,
    width: f64,
    done: bool,
) -> Option<()> {
    let window = app.get_webview_window("marquee")?;
    let monitor = marquee_monitor(&window);
    let state = app.state::<AppState>();
    let ui_snap = state.ui.snapshot();
    let prefs = SizePrefs::from_ui(&ui_snap);
    let dock = state
        .marquee_fit
        .current()
        .map_or(ui_snap.marquee_dock, |f| f.dock);
    let position = window_position(&window);
    let screen = monitor
        .as_ref()
        .map(|m| screen_for_monitor(app, &window, m));

    let (frame, base_width, target_pos) = match (screen.as_ref(), position, anchor_x) {
        (Some(screen), Some(position), Some(anchor_x)) => {
            let sf = screen.sf;
            let monitor_x = screen.monitor.position().x;
            let anchor = (f64::from(anchor_x) - f64::from(monitor_x)) / sf;
            let room = match edge {
                ResizeEdge::Left => {
                    if dock.left {
                        0.0
                    } else {
                        anchor - screen.bounds.work_safe.left
                    }
                }
                ResizeEdge::Right => {
                    if dock.right {
                        0.0
                    } else {
                        screen.bounds.work_safe.right - anchor
                    }
                }
            };
            let (frame, base_width, mut x) = resize_frame(
                prefs,
                screen.bounds.display(),
                dock,
                width,
                edge,
                anchor,
                room,
            );
            if dock.left {
                x = 0.0;
            } else if dock.right {
                x = (screen.bounds.width - f64::from(frame.width)).max(0.0);
            }
            let phys_x = monitor_x + (x * sf).round() as i32;
            let phys_y = if dock.bottom {
                let y = (screen.bounds.height - f64::from(frame.height)).max(0.0);
                screen.monitor.position().y + (y * sf).round() as i32
            } else {
                position.y
            };
            (frame, base_width, Some((phys_x, phys_y)))
        }
        _ => {
            let display = display_for(&window, monitor.as_ref());
            let (frame, base_width, _) =
                resize_frame(prefs, display, dock, width, edge, 0.0, f64::INFINITY);
            (frame, base_width, None)
        }
    };

    crate::macos::resize_marquee_window(
        &window,
        frame.width,
        frame.height,
        target_pos,
        dock.bottom,
    )
    .ok()?;

    let previous = state.marquee_fit.current();
    state.marquee_fit.replace(frame);
    // The native window supplies its own viewport size during the drag.
    // Publish only changes that the WebView needs to lay out immediately.
    if done
        || previous.is_none_or(|last| {
            last.scale != frame.scale
                || last.notch_inset != frame.notch_inset
                || last.dock != frame.dock
        })
    {
        emit_marquee_frame(app, frame);
    }
    if done {
        let new_state = state.ui.mutate(|s| {
            s.marquee_base_width = base_width;
            s.marquee_dock = frame.dock;
            if let Some(pos) = target_pos {
                s.marquee_pos = Some(pos);
            }
        });
        let _ = app.emit("ui-settings-changed", new_state);
    }
    Some(())
}

// ── Fitting & Placement ───────────────────────────────────────────────────────

/// Fit the Marquee window to its display and placement.
///
/// `resize` is true when the size preferences changed: the window takes the
/// new frame even if the frame matches the last one. Otherwise (the window
/// moved) it is resized only when the frame changed, outside an edge drag,
/// live drag, or spring animation.
pub fn fit_marquee(app: &AppHandle, resize: bool) {
    let handle = app.clone();
    // Window and screen geometry are AppKit calls on macOS.
    let _ = app.run_on_main_thread(move || fit_marquee_now(&handle, resize));
}

/// [`fit_marquee`], for callers already on the main thread.
pub fn fit_marquee_now(app: &AppHandle, resize: bool) {
    let state = app.state::<AppState>();
    if !resize && state.marquee_fit.is_busy() {
        return;
    }
    let Some(window) = app.get_webview_window("marquee") else {
        return;
    };
    let Some(current) = window_points(&window) else {
        return;
    };
    let monitor = marquee_monitor(&window);
    let screen = monitor
        .as_ref()
        .map(|m| screen_for_monitor(app, &window, m));
    let ui = state.ui.snapshot();

    let at_saved_place = window_position(&window).is_some_and(|position| {
        ui.marquee_pos
            .is_some_and(|(x, y)| (position.x - x).abs() <= 1 && (position.y - y).abs() <= 1)
    });
    let current_dock = if at_saved_place {
        ui.marquee_dock
    } else {
        state.marquee_fit.current().map_or(DockEdges::NONE, |f| f.dock)
    };

    let (placement, display) = match screen.as_ref() {
        Some(screen) => {
            let (x, y) = origin_on(&window, &screen.monitor).unwrap_or((0.0, 0.0));
            let inferred_top = y.abs() < 0.5 && ui.marquee_pos.is_some();
            let dock = DockEdges {
                top: current_dock.top || inferred_top,
                ..current_dock
            };
            (
                Placement {
                    center_x: x + current.0 / 2.0,
                    dock,
                },
                screen.bounds.display(),
            )
        }
        None => (
            Placement {
                center_x: 0.0,
                dock: DockEdges::NONE,
            },
            display_for(&window, monitor.as_ref()),
        ),
    };

    let frame = marquee_frame(SizePrefs::from_ui(&ui), display, placement);
    let changed = state.marquee_fit.replace(frame);
    if !changed && !resize {
        return;
    }

    let new = (f64::from(frame.width), f64::from(frame.height));
    if (current.0 - new.0).abs() >= 1.0 || (current.1 - new.1).abs() >= 1.0 {
        if let Some(screen) = screen {
            let (x, y) = origin_on(&window, &screen.monitor).unwrap_or((0.0, 0.0));
            let ((nx, ny), settled_dock) =
                refit_placement(screen.bounds, x, y, current, new, placement.dock);
            let bleed = GlassBleed::from_dock(settled_dock, 0.0, 0.0);
            let animate = resize && window.is_visible().unwrap_or(false);
            drive_spring_to(
                app,
                &window,
                screen.clone(),
                SpringTarget {
                    x: nx,
                    y: ny,
                    w: new.0,
                    h: new.1,
                    bleed,
                },
                settled_dock,
                SpringPreset::Attach,
                animate,
            );
            let moved = screen.phys_origin(nx, ny);
            if at_saved_place && (ui.marquee_pos != Some(moved) || ui.marquee_dock != settled_dock)
            {
                remember_placement(app, moved, settled_dock);
            }
        } else {
            let _ = crate::macos::set_marquee_size(app, frame.width, frame.height);
        }
    }
    if changed {
        emit_marquee_frame(app, frame);
    }
}

/// Put the Marquee in its place: where the user left it, settled into the
/// safe area (or docked flush to its saved edges) on the display it is on, or
/// else the default place on `monitor` (the display it is on when `None`).
pub fn place_marquee(app: &AppHandle, monitor: Option<tauri::Monitor>) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || place_marquee_now(&handle, monitor));
}

fn place_marquee_now(app: &AppHandle, monitor: Option<tauri::Monitor>) {
    let Some(window) = app.get_webview_window("marquee") else {
        return;
    };
    forget_old_default_place(app, &window);
    if crate::linux::native_wayland() {
        return;
    }
    let state = app.state::<AppState>();
    let ui = state.ui.snapshot();
    let saved = ui.marquee_pos;
    let saved_monitor = saved.and_then(|(x, y)| {
        window.available_monitors().ok()?.into_iter().find(|m| {
            let dx = i64::from(x) - i64::from(m.position().x);
            let dy = i64::from(y) - i64::from(m.position().y);
            (0..i64::from(m.size().width)).contains(&dx)
                && (0..i64::from(m.size().height)).contains(&dy)
        })
    });
    let Some(monitor) = saved_monitor
        .or(monitor)
        .or_else(|| marquee_monitor(&window))
    else {
        return;
    };
    let screen = screen_for_monitor(app, &window, &monitor);
    let prefs = SizePrefs::from_ui(&ui);

    // Estimate base frame so we know width/height before computing placement.
    let approx_frame = marquee_frame(
        prefs,
        screen.bounds.display(),
        Placement {
            center_x: screen.bounds.width / 2.0,
            dock: ui.marquee_dock,
        },
    );
    let (approx_w, approx_h) = (f64::from(approx_frame.width), f64::from(approx_frame.height));

    let (origin, dock) = if let Some((px, py)) = saved {
        let sf = screen.sf;
        let lx = (f64::from(px) - f64::from(screen.monitor.position().x)) / sf;
        let ly = (f64::from(py) - f64::from(screen.monitor.position().y)) / sf;
        // Older states saved top-docking purely by `y == 0` without `marquee_dock`.
        let mut active_dock = ui.marquee_dock;
        if ly.abs() < 0.5 && !active_dock.bottom {
            active_dock.top = true;
        }
        settle_placement(
            screen.bounds,
            lx,
            ly,
            approx_w,
            approx_h,
            Some(active_dock),
            false,
        )
    } else {
        (
            default_origin(screen.bounds.float_safe, approx_w, approx_h),
            DockEdges::NONE,
        )
    };

    let frame = frame_with_center(prefs, screen.bounds.display(), dock, |w| {
        if dock.left {
            w / 2.0
        } else if dock.right {
            screen.bounds.width - w / 2.0
        } else {
            origin.0 + w / 2.0
        }
    });
    let fw = f64::from(frame.width);
    let fh = f64::from(frame.height);
    let (final_origin, final_dock) = if saved.is_some() {
        settle_placement(
            screen.bounds,
            origin.0 + (approx_w - fw) / 2.0,
            origin.1,
            fw,
            fh,
            Some(dock),
            false,
        )
    } else {
        (default_origin(screen.bounds.float_safe, fw, fh), DockEdges::NONE)
    };

    if state.marquee_fit.replace(frame) {
        emit_marquee_frame(app, frame);
    }

    let animate = window.is_visible().unwrap_or(false) && saved.is_none();
    drive_spring_to(
        app,
        &window,
        screen,
        SpringTarget {
            x: final_origin.0,
            y: final_origin.1,
            w: fw,
            h: fh,
            bleed: GlassBleed::from_dock(final_dock, 0.0, 0.0),
        },
        final_dock,
        SpringPreset::Attach,
        animate,
    );
}

/// Earlier versions saved the Marquee's starting place, centred against the
/// top edge, as though the user had put it there. Forget such a place once,
/// so that Marquee starts in today's default place. A Marquee the user docked
/// near the top centre then moves too; one anywhere else keeps its place.
fn forget_old_default_place(app: &AppHandle, window: &tauri::WebviewWindow) {
    let state = app.state::<AppState>();
    let ui = state.ui.snapshot();
    if ui.marquee_pos_checked {
        return;
    }
    let width = window.outer_size().map_or(0, |size| size.width as i32);
    let monitors = window.available_monitors().unwrap_or_default();
    let old_default = ui.marquee_pos.is_some_and(|(x, y)| {
        monitors.iter().any(|monitor| {
            let monitor_width = monitor.size().width as i32;
            let center = monitor.position().x + monitor_width / 2;
            y == monitor.position().y && (x + width / 2 - center).abs() <= monitor_width / 10
        })
    });
    let new_state = state.ui.mutate(|s| {
        s.marquee_pos_checked = true;
        if old_default {
            s.marquee_pos = None;
            s.marquee_dock = DockEdges::NONE;
        }
    });
    if old_default {
        let _ = app.emit("ui-settings-changed", new_state);
    }
}

/// Settle the Marquee after a legacy drag call and save where it ends up.
pub fn settle_marquee(app: &AppHandle) {
    end_marquee_drag(app);
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
    const DOCKED_TOP: Placement = Placement {
        center_x: 756.0,
        dock: DockEdges {
            top: true,
            right: false,
            bottom: false,
            left: false,
        },
    };
    const FLOATING: Placement = Placement {
        center_x: 756.0,
        dock: DockEdges::NONE,
    };
    const MARQUEE: (f64, f64) = (510.0, 61.0);

    /// A 14" MacBook Pro: the menu bar above and the Dock below (37pt menu bar, 72pt Dock).
    fn laptop_area() -> SafeArea {
        SafeArea::new(0.0, 37.0, 1512.0, 873.0, 0.0)
    }

    fn laptop_bounds() -> DisplayBounds {
        DisplayBounds::from_safe(1512.0, 982.0, laptop_area(), None)
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
        let frame = marquee_frame(prefs(Some(1.2)), DESKTOP_1440P, FLOATING);
        assert_eq!((frame.width, frame.height), (720, 86));
        assert_eq!(frame.scale, 1.2);
        assert!(!frame.auto_scale);
    }

    #[test]
    fn match_screen_is_reported_as_automatic() {
        let frame = marquee_frame(prefs(None), LAPTOP, FLOATING);
        assert!(frame.auto_scale);
        assert_eq!(frame.scale, 0.85);
        assert_eq!((frame.width, frame.height), (510, 61));
    }

    #[test]
    fn width_never_exceeds_its_share_of_the_display() {
        let frame = marquee_frame(prefs(Some(1.4)), LAPTOP, FLOATING);
        assert_eq!(frame.max_width, 680);
        assert_eq!(frame.width, 680);
        // Height keeps the chosen size; only the width gives way.
        assert_eq!(frame.height, 101);
    }

    #[test]
    fn one_line_is_shorter() {
        let mut one_line = prefs(Some(1.0));
        one_line.lines = 1;
        assert_eq!(marquee_frame(one_line, LAPTOP, FLOATING).height, 56);
    }

    #[test]
    fn content_moves_below_the_notch_only_when_docked_under_it() {
        let under = marquee_frame(prefs(Some(1.0)), NOTCHED, DOCKED_TOP);
        assert_eq!(under.notch_inset, 32);
        assert_eq!(under.height, 104);
        assert!(under.docked);
        assert!(under.dock.top);

        let floating = marquee_frame(prefs(Some(1.0)), NOTCHED, FLOATING);
        assert_eq!(floating.notch_inset, 0);
        assert!(!floating.docked);

        let beside = Placement {
            center_x: 200.0,
            dock: DockEdges {
                top: true,
                ..DockEdges::NONE
            },
        };
        let frame = marquee_frame(prefs(Some(1.0)), NOTCHED, beside);
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
        assert_eq!(marquee_frame(narrow, wide_notch, DOCKED_TOP).width, 496);
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
        // Pushing past the right edge attaches top-right corner too.
        assert_eq!(settle(1100.0, -30.0), (1002.0, 0.0));
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
        // Near right margin (not pushed past screen edge) snaps to 12pt margin.
        assert_eq!(settle(975.0, 400.0), (990.0, 400.0));
        // Released just inside a visible Dock settles above it; pushed past halfway
        // docks flush to the physical bottom edge.
        let bounds = laptop_bounds();
        let (pos, dock) = settle_placement(bounds, 501.0, 865.0, MARQUEE.0, MARQUEE.1, None, true);
        assert_eq!(pos, (501.0, 837.0));
        assert!(!dock.bottom);
        let (pos, dock) = settle_placement(bounds, 501.0, 900.0, MARQUEE.0, MARQUEE.1, None, true);
        assert_eq!(pos, (501.0, 982.0 - MARQUEE.1));
        assert!(dock.bottom);
    }

    #[test]
    fn attaches_flush_to_all_four_edges_and_all_four_corners() {
        let bounds = laptop_bounds();
        // Bottom-left corner
        let (pos, dock) = settle_placement(bounds, -10.0, 940.0, MARQUEE.0, MARQUEE.1, None, true);
        assert_eq!(pos, (0.0, 982.0 - MARQUEE.1));
        assert_eq!(
            dock,
            DockEdges {
                top: false,
                right: false,
                bottom: true,
                left: true,
            }
        );
        // Top-right corner
        let (pos, dock) = settle_placement(bounds, 1040.0, -5.0, MARQUEE.0, MARQUEE.1, None, true);
        assert_eq!(pos, (1512.0 - MARQUEE.0, 0.0));
        assert_eq!(
            dock,
            DockEdges {
                top: true,
                right: true,
                bottom: false,
                left: false,
            }
        );
        // Left-edge mid-screen snaps vertically to center when near center.
        let (pos, dock) = settle_placement(bounds, -5.0, 435.0, MARQUEE.0, MARQUEE.1, None, true);
        assert_eq!(pos.0, 0.0);
        assert!(dock.left && !dock.top && !dock.bottom);
    }

    #[test]
    fn liquid_drag_clings_then_snaps_off_on_each_edge_and_corner() {
        let bounds = laptop_bounds();
        let adj = AdjacentMonitors::default();

        // Top-left corner: pulling down inside BREAKAWAY_PX keeps top & left flush
        // while ramping pull_y.
        let corner = DockEdges {
            top: true,
            left: true,
            right: false,
            bottom: false,
        };
        let step = evaluate_liquid_drag(
            bounds,
            adj,
            DockEdges::NONE,
            corner,
            0.0,
            17.0,
            MARQUEE.0,
            MARQUEE.1,
        );
        assert_eq!(step.dock, corner);
        assert_eq!((step.target_x, step.target_y), (0.0, 0.0));
        assert!((step.pull_y - 0.5).abs() < 1e-6);
        assert_eq!(step.pull_x, 0.0);

        // Pulling past BREAKAWAY_PX vertically snaps off top while keeping left docked!
        let step = evaluate_liquid_drag(
            bounds,
            adj,
            DockEdges::NONE,
            corner,
            10.0,
            40.0,
            MARQUEE.0,
            MARQUEE.1,
        );
        assert!(!step.dock.top);
        assert!(step.dock.left);
        assert_eq!(step.target_x, 0.0);
        assert_eq!(step.target_y, 40.0);
        assert_eq!(step.impulses, vec![DockImpulse::DetachTop]);

        // Right edge cling & snap-off
        let right_dock = DockEdges {
            right: true,
            ..DockEdges::NONE
        };
        let max_x = bounds.width - MARQUEE.0;
        let cling = evaluate_liquid_drag(
            bounds,
            adj,
            DockEdges::NONE,
            right_dock,
            max_x - 17.0,
            400.0,
            MARQUEE.0,
            MARQUEE.1,
        );
        assert!(cling.dock.right);
        assert_eq!(cling.target_x, max_x);
        assert!((cling.pull_x + 0.5).abs() < 1e-6);

        let snap = evaluate_liquid_drag(
            bounds,
            adj,
            DockEdges::NONE,
            right_dock,
            max_x - BREAKAWAY_PX - 1.0,
            400.0,
            MARQUEE.0,
            MARQUEE.1,
        );
        assert!(!snap.dock.right);
        assert_eq!(snap.impulses, vec![DockImpulse::DetachRight]);

        // Bottom edge cling & snap-off
        let bottom_dock = DockEdges {
            bottom: true,
            ..DockEdges::NONE
        };
        let max_y = bounds.height - MARQUEE.1;
        let cling = evaluate_liquid_drag(
            bounds,
            adj,
            DockEdges::NONE,
            bottom_dock,
            500.0,
            max_y - 17.0,
            MARQUEE.0,
            MARQUEE.1,
        );
        assert!(cling.dock.bottom);
        assert_eq!(cling.target_y, max_y);
        assert!((cling.pull_y + 0.5).abs() < 1e-6);

        let snap = evaluate_liquid_drag(
            bounds,
            adj,
            DockEdges::NONE,
            bottom_dock,
            500.0,
            max_y - BREAKAWAY_PX - 1.0,
            MARQUEE.0,
            MARQUEE.1,
        );
        assert!(!snap.dock.bottom);
        assert_eq!(snap.impulses, vec![DockImpulse::DetachBottom]);
    }

    #[test]
    fn pushing_past_an_adjacent_monitor_border_crosses_cleanly() {
        let bounds = laptop_bounds();
        let adj = AdjacentMonitors {
            right: true,
            ..AdjacentMonitors::default()
        };
        let right_dock = DockEdges {
            right: true,
            ..DockEdges::NONE
        };
        let max_x = bounds.width - MARQUEE.0;

        // Inside detent (< 44pt), stays latched to the shared border.
        let detent = evaluate_liquid_drag(
            bounds,
            adj,
            DockEdges::NONE,
            right_dock,
            max_x + 20.0,
            400.0,
            MARQUEE.0,
            MARQUEE.1,
        );
        assert!(detent.dock.right);
        assert_eq!(detent.cross_edge, None);

        // Past MULTI_MONITOR_BREAKAWAY_PX, releases into the adjacent monitor.
        let crossed = evaluate_liquid_drag(
            bounds,
            adj,
            DockEdges::NONE,
            right_dock,
            max_x + MULTI_MONITOR_BREAKAWAY_PX + 2.0,
            400.0,
            MARQUEE.0,
            MARQUEE.1,
        );
        assert!(!crossed.dock.right);
        assert_eq!(crossed.cross_edge, Some(ScreenEdge::Right));
    }

    #[test]
    fn glass_bleed_peels_in_lockstep_with_pull_tension() {
        let dock = DockEdges {
            top: true,
            right: true,
            bottom: false,
            left: false,
        };
        let rest = GlassBleed::from_dock(dock, 0.0, 0.0);
        assert_eq!(rest.top, 20.0);
        assert_eq!(rest.right, 20.0);
        assert_eq!(rest.bottom, 0.0);
        assert_eq!(rest.left, 0.0);

        let full_pull = GlassBleed::from_dock(dock, -1.0, 1.0);
        assert!((full_pull.top - 13.0).abs() < 1e-6);
        assert!((full_pull.right - 13.0).abs() < 1e-6);
    }

    #[test]
    fn frame_spring_converges_smoothly_to_target() {
        let start = SpringTarget {
            x: 500.0,
            y: 400.0,
            w: 510.0,
            h: 61.0,
            bleed: GlassBleed::ZERO,
        };
        let target = SpringTarget {
            x: 1002.0,
            y: 921.0,
            w: 510.0,
            h: 61.0,
            bleed: GlassBleed::from_dock(
                DockEdges {
                    right: true,
                    bottom: true,
                    ..DockEdges::NONE
                },
                0.0,
                0.0,
            ),
        };
        let mut spring = FrameSpring::at(start);
        for _ in 0..80 {
            spring.step(target, SpringPreset::Attach, 0.008);
        }
        assert!(spring.is_settled(target));
    }

    #[test]
    fn frame_spring_steers_smoothly_when_target_updates_mid_flight() {
        let start = SpringTarget {
            x: 500.0,
            y: 0.0,
            w: 510.0,
            h: 61.0,
            bleed: GlassBleed::from_dock(
                DockEdges {
                    top: true,
                    ..DockEdges::NONE
                },
                0.0,
                0.0,
            ),
        };
        let mut target = SpringTarget {
            x: 500.0,
            y: 42.0,
            w: 510.0,
            h: 61.0,
            bleed: GlassBleed::ZERO,
        };
        let mut spring = FrameSpring::at(start);
        // Simulate 40ms of chase after snap-off, then continued cursor drag.
        for _ in 0..5 {
            spring.step(target, SpringPreset::Chase, 0.008);
        }
        assert!(spring.y.val > 0.0 && spring.y.val < 42.0);
        target.x = 545.0;
        target.y = 140.0;
        for _ in 0..80 {
            spring.step(target, SpringPreset::Chase, 0.008);
        }
        assert!(spring.is_settled(target));
    }

    #[test]
    fn karaoke_does_not_block_bottom_edge_docking() {
        let work = laptop_area();
        let float = work.clear_of(808.0, 898.0);
        let bounds = DisplayBounds::new(1512.0, 982.0, work, float, None);
        // Floating settles above Karaoke.
        let (pos, dock) = settle_placement(bounds, 501.0, 820.0, MARQUEE.0, MARQUEE.1, None, true);
        assert_eq!(pos, (501.0, 808.0 - 12.0 - MARQUEE.1));
        assert!(!dock.bottom);
        // Pushing past the OS Dock line attaches flush to the bottom edge.
        let (pos, dock) = settle_placement(bounds, 501.0, 900.0, MARQUEE.0, MARQUEE.1, None, true);
        assert_eq!(pos, (501.0, 982.0 - MARQUEE.1));
        assert!(dock.bottom);
    }

    #[test]
    fn a_resized_marquee_keeps_its_nearer_edge_and_docked_edges() {
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
        // Bottom-right corner dock keeps bottom & right flush when size changes.
        let bounds = laptop_bounds();
        let corner = DockEdges {
            right: true,
            bottom: true,
            ..DockEdges::NONE
        };
        let (pos, dock) = refit_placement(
            bounds,
            1512.0 - MARQUEE.0,
            982.0 - MARQUEE.1,
            MARQUEE,
            (600.0, 72.0),
            corner,
        );
        assert_eq!(pos, (1512.0 - 600.0, 982.0 - 72.0));
        assert_eq!(dock, corner);
    }

    #[test]
    fn an_edge_drag_only_moves_the_grabbed_edge() {
        let prefs = prefs(Some(0.85));
        for width in [470.0, 550.0] {
            let (left, _, x) = resize_frame(
                prefs,
                LAPTOP,
                DockEdges::NONE,
                width,
                ResizeEdge::Left,
                1011.0,
                1011.0,
            );
            assert_eq!(f64::from(left.width), width);
            assert_eq!(x + f64::from(left.width), 1011.0);

            let (right, _, x) = resize_frame(
                prefs,
                LAPTOP,
                DockEdges::NONE,
                width,
                ResizeEdge::Right,
                501.0,
                1011.0,
            );
            assert_eq!(f64::from(right.width), width);
            assert_eq!(x, 501.0);
        }
    }

    #[test]
    fn an_edge_drag_stops_at_the_work_area_and_minimum_width() {
        let prefs = prefs(Some(1.0));
        let (frame, _, x) = resize_frame(
            prefs,
            LAPTOP,
            DockEdges::NONE,
            700.0,
            ResizeEdge::Right,
            1112.0,
            400.0,
        );
        assert_eq!((x, frame.width), (1112.0, 400));
        let (frame, _, x) = resize_frame(
            prefs,
            LAPTOP,
            DockEdges::NONE,
            120.0,
            ResizeEdge::Left,
            700.0,
            700.0,
        );
        assert_eq!((x, frame.width), (340.0, 360));
    }

    #[test]
    fn an_edge_drag_can_leave_the_notch_without_moving_the_opposite_edge() {
        let prefs = prefs(Some(1.0));
        let top = DockEdges {
            top: true,
            ..DockEdges::NONE
        };
        let (wide, _, x) = resize_frame(
            prefs,
            NOTCHED,
            top,
            600.0,
            ResizeEdge::Right,
            100.0,
            1412.0,
        );
        assert_eq!((x, wide.notch_inset), (100.0, 32));
        let (narrow, _, x) = resize_frame(
            prefs,
            NOTCHED,
            top,
            400.0,
            ResizeEdge::Right,
            100.0,
            1412.0,
        );
        assert_eq!((x, narrow.notch_inset), (100.0, 0));
        assert!(narrow.docked);
        assert!(narrow.dock.top);
    }

    #[test]
    fn restoring_a_resize_preserves_its_position_near_the_center_guide() {
        let bounds = laptop_bounds();
        assert_eq!(
            settle_placement(bounds, 501.0, 837.0, 550.0, 61.0, None, false).0,
            (501.0, 837.0)
        );
        assert_eq!(
            settle_placement(bounds, 501.0, 837.0, 550.0, 61.0, None, true).0,
            (481.0, 837.0)
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

    #[test]
    fn drag_delta_stays_continuous_when_native_button_releases() {
        let mut used_native = false;
        let mut native_minus_dom = (0.0, 0.0);

        // User pressed at DOM (100, 100); threshold + IPC fired when pointer
        // reached AppKit (106, 102). During live drag DOM delta is (40, 20)
        // while AppKit delta from begin point is (34, 18).
        let live = resolve_drag_delta(
            40.0,
            20.0,
            Some((106.0, 102.0)),
            Some((140.0, 120.0)),
            &mut used_native,
            &mut native_minus_dom,
        );
        assert_eq!(live, (34.0, 18.0));
        assert!(used_native);

        // On pointerup AppKit pressedMouseButtons drops to None; final DOM
        // move must retain the -6/-2 baseline offset so release does not jump.
        let released = resolve_drag_delta(
            40.0,
            20.0,
            Some((106.0, 102.0)),
            None,
            &mut used_native,
            &mut native_minus_dom,
        );
        assert_eq!(released, (34.0, 18.0));
    }

    #[test]
    fn drag_delta_falls_back_to_dom_when_native_pointer_never_reported() {
        let mut used_native = false;
        let mut native_minus_dom = (0.0, 0.0);

        let step = resolve_drag_delta(
            48.0,
            -16.0,
            None,
            None,
            &mut used_native,
            &mut native_minus_dom,
        );
        assert_eq!(step, (48.0, -16.0));
        assert!(!used_native);
    }
}
