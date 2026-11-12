use crate::marquee_size;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct UiState {
    #[serde(default = "default_true", alias = "island_visible")]
    pub marquee_visible: bool,
    #[serde(default = "default_true")]
    pub floating_visible: bool,
    #[serde(default)]
    pub karaoke_visible: bool,
    /// Position lock: the marquee can't be dragged. It still takes hover and
    /// clicks unless `marquee_click_through` is on. Off by default, so the
    /// marquee can be moved straight away.
    #[serde(default, alias = "island_locked")]
    pub marquee_locked: bool,
    /// The marquee ignores the mouse entirely; clicks reach the app behind it.
    #[serde(default, alias = "island_click_through")]
    pub marquee_click_through: bool,
    /// Top-left corner, in physical pixels, where the user left the marquee.
    /// `None` keeps it in its default place (see `marquee_size`).
    #[serde(default, alias = "island_pos")]
    pub marquee_pos: Option<(i32, i32)>,
    /// `marquee_pos` has been checked for the top-centre starting place that
    /// earlier versions saved as though the user had chosen it. States saved
    /// before the check existed get it once; a fresh install needs none.
    #[serde(default, alias = "island_pos_checked")]
    pub marquee_pos_checked: bool,
    /// The marquee hides while no player has a track, rather than showing an
    /// empty panel over other apps. A paused track still shows.
    #[serde(default = "default_true", alias = "island_hide_when_idle")]
    pub marquee_hide_when_idle: bool,
    /// Size, as a multiple of the base design (see `marquee_size`). `None`
    /// matches it to the display the marquee is on.
    #[serde(default, alias = "island_scale")]
    pub marquee_scale: Option<f32>,
    /// Width at Medium size, in points; other sizes scale it.
    #[serde(default = "default_marquee_base_width", alias = "island_base_width")]
    pub marquee_base_width: u32,
    /// 2 shows the current and next line, 1 only the current one.
    #[serde(default = "default_marquee_lines", alias = "island_lines")]
    pub marquee_lines: u8,
    /// Width and height in points from before sizes were scales. Read once
    /// and converted by `migrate_legacy_marquee_size`; never written back.
    #[serde(default, skip_serializing, alias = "island_width")]
    pub marquee_width: Option<u32>,
    #[serde(default, skip_serializing, alias = "island_height")]
    pub marquee_height: Option<u32>,

    #[serde(default = "default_font_scale", alias = "island_font_scale")]
    pub marquee_font_scale: f32,
    #[serde(default = "default_font_scale")]
    pub karaoke_font_scale: f32,
    #[serde(default = "default_font_scale")]
    pub floating_font_scale: f32,

    #[serde(default = "default_true", alias = "island_show_cover")]
    pub marquee_show_cover: bool,
    #[serde(default, alias = "island_cover_circle")]
    pub marquee_cover_circle: bool,
    #[serde(default, alias = "island_cover_spin")]
    pub marquee_cover_spin: bool,
    /// How much of the backdrop shows through the marquee: 0 is solid, 1 the
    /// clearest. 0.5 is the standard look.
    #[serde(
        default = "default_marquee_transparency",
        alias = "island_transparency"
    )]
    pub marquee_transparency: f32,

    #[serde(default = "default_true", alias = "island_show_on_fullscreen")]
    pub marquee_show_on_fullscreen: bool,
    #[serde(default = "default_true")]
    pub karaoke_show_on_fullscreen: bool,
    #[serde(default)]
    pub floating_show_on_fullscreen: bool,

    #[serde(default = "default_theme")]
    pub theme: String,

    #[serde(default = "default_karaoke_position")]
    pub karaoke_position: String,
    #[serde(default = "default_karaoke_alignment")]
    pub karaoke_alignment: String,
    #[serde(default = "default_karaoke_width_pct")]
    pub karaoke_width_pct: u32,
    #[serde(default = "default_karaoke_offset_px")]
    pub karaoke_offset_px: u32,
    #[serde(default = "default_karaoke_lines")]
    pub karaoke_lines: u8,
    #[serde(default)]
    pub karaoke_bg_opacity: f32,
    #[serde(default = "default_true")]
    pub karaoke_bold: bool,

    /// Whether the app should launch automatically at login.
    #[serde(default)]
    pub autostart_enabled: bool,

    /// The name of the monitor all surfaces should appear on.
    /// `None` means use the primary (default) monitor.
    #[serde(default)]
    pub preferred_monitor: Option<String>,

    /// A Lyra button in the Touch Bar's Control Strip that shows the lyrics
    /// bar over any app. Off by default: it relies on undocumented macOS
    /// calls (see `touch_bar`).
    #[serde(default)]
    pub touch_bar_control_strip: bool,

    /// The first-run explanation has been shown. Saved states from before it
    /// existed count as done; only a fresh install sees it.
    #[serde(default = "default_true")]
    pub onboarded: bool,
}

fn default_true() -> bool {
    true
}
fn default_font_scale() -> f32 {
    1.0
}
fn default_marquee_base_width() -> u32 {
    marquee_size::DEFAULT_BASE_WIDTH
}
fn default_marquee_lines() -> u8 {
    marquee_size::DEFAULT_LINES
}
fn default_marquee_transparency() -> f32 {
    0.5
}
fn default_theme() -> String {
    "auto".into()
}
fn default_karaoke_position() -> String {
    "bottom".into()
}
fn default_karaoke_alignment() -> String {
    "center".into()
}
fn default_karaoke_width_pct() -> u32 {
    100
}
fn default_karaoke_offset_px() -> u32 {
    24
}
fn default_karaoke_lines() -> u8 {
    2
}

impl UiState {
    /// Convert a saved width and height from before sizes were scales into
    /// the closest size, width and line count. States saved without them keep
    /// matching the display.
    fn migrate_legacy_marquee_size(&mut self) {
        let width = self.marquee_width.take();
        if let Some(height) = self.marquee_height.take() {
            let prefs = marquee_size::from_legacy_size(width, height);
            self.marquee_scale = prefs.scale;
            self.marquee_base_width = prefs.base_width;
            self.marquee_lines = prefs.lines;
        }
    }
}

impl Default for UiState {
    fn default() -> Self {
        Self {
            marquee_visible: true,
            floating_visible: true,
            karaoke_visible: false,
            marquee_locked: false,
            marquee_click_through: false,
            marquee_pos: None,
            marquee_pos_checked: true,
            marquee_hide_when_idle: true,
            marquee_scale: None,
            marquee_base_width: marquee_size::DEFAULT_BASE_WIDTH,
            marquee_lines: marquee_size::DEFAULT_LINES,
            marquee_width: None,
            marquee_height: None,
            marquee_font_scale: 1.0,
            karaoke_font_scale: 1.0,
            floating_font_scale: 1.0,
            marquee_show_cover: true,
            marquee_cover_circle: false,
            marquee_cover_spin: false,
            marquee_transparency: 0.5,
            marquee_show_on_fullscreen: true,
            karaoke_show_on_fullscreen: true,
            floating_show_on_fullscreen: false,
            theme: "auto".into(),
            karaoke_position: "bottom".into(),
            karaoke_alignment: "center".into(),
            karaoke_width_pct: 100,
            karaoke_offset_px: 24,
            karaoke_lines: 2,
            karaoke_bg_opacity: 0.0,
            karaoke_bold: true,
            autostart_enabled: false,
            preferred_monitor: None,
            touch_bar_control_strip: false,
            onboarded: false,
        }
    }
}

pub struct UiStateStore {
    path: PathBuf,
    inner: Mutex<UiState>,
}

impl UiStateStore {
    pub fn load(dir: &Path) -> Self {
        let path = dir.join("ui_state.json");
        let mut state = std::fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str::<UiState>(&s).ok())
            .unwrap_or_default();
        state.migrate_legacy_marquee_size();
        Self {
            path,
            inner: Mutex::new(state),
        }
    }

    pub fn snapshot(&self) -> UiState {
        self.inner.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }

    /// Cheap read-only accessor for the three surface-visibility flags.
    /// Used by the polling driver to avoid cloning the full 25-field UiState
    /// on every tick when it only needs visibility.
    pub fn visibility_triple(&self) -> (bool, bool, bool) {
        match self.inner.lock() {
            Ok(g) => (g.floating_visible, g.marquee_visible, g.karaoke_visible),
            Err(_) => (false, false, false),
        }
    }

    pub fn mutate<F: FnOnce(&mut UiState)>(&self, f: F) -> UiState {
        let mut guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        f(&mut guard);
        let snap = guard.clone();
        drop(guard);
        self.save(&snap);
        snap
    }

    fn save(&self, state: &UiState) {
        let path = self.path.clone();
        let state = state.clone();
        tauri::async_runtime::spawn(async move {
            if let Some(parent) = path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            // Compact JSON — file is not user-edited and sliders can fire many
            // mutate-save cycles per drag. to_string is ~3-5× faster than
            // to_string_pretty and writes a smaller file.
            if let Ok(json) = serde_json::to_string(&state) {
                let _ = std::fs::write(path, json);
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn states_saved_before_marquee_transparency_load_the_standard_look() {
        let state: UiState = serde_json::from_str(r#"{"marquee_visible":true}"#).unwrap();
        assert_eq!(state.marquee_transparency, 0.5);
    }

    #[test]
    fn a_fresh_marquee_can_be_moved_and_hides_with_nothing_playing() {
        let state = UiState::default();
        assert!(!state.marquee_locked);
        assert!(state.marquee_hide_when_idle);
        assert_eq!(state.marquee_pos, None);
    }

    #[test]
    fn states_saved_before_marquee_idle_hiding_hide_the_marquee_when_idle() {
        let state: UiState =
            serde_json::from_str(r#"{"marquee_visible":true,"marquee_locked":true}"#).unwrap();
        assert!(state.marquee_hide_when_idle);
        assert!(state.marquee_locked);
        // Their saved place is checked once for the old starting place.
        assert!(!state.marquee_pos_checked);
        assert!(UiState::default().marquee_pos_checked);
    }

    #[test]
    fn states_saved_without_a_size_match_the_display() {
        let mut state: UiState = serde_json::from_str(r#"{"marquee_visible":true}"#).unwrap();
        state.migrate_legacy_marquee_size();
        assert_eq!(state.marquee_scale, None);
        assert_eq!(state.marquee_base_width, marquee_size::DEFAULT_BASE_WIDTH);
        assert_eq!(state.marquee_lines, 2);
    }

    #[test]
    fn a_saved_width_and_height_become_a_size_and_are_not_saved_again() {
        let mut state: UiState =
            serde_json::from_str(r#"{"island_width":500,"island_height":52}"#).unwrap();
        state.migrate_legacy_marquee_size();
        assert_eq!(state.marquee_scale, Some(1.0));
        assert_eq!(state.marquee_base_width, 500);
        assert_eq!(state.marquee_lines, 1);

        let saved = serde_json::to_string(&state).unwrap();
        assert!(!saved.contains("island_"));
        assert!(!saved.contains("marquee_width"));
        assert!(!saved.contains("marquee_height"));
    }

    /// A `ui_state.json` written before the island → Marquee rename keeps
    /// every Marquee setting, and the next save writes the new keys only.
    #[test]
    fn states_saved_with_island_keys_keep_every_marquee_setting() {
        let old = r#"{
            "floating_visible": true,
            "island_visible": false,
            "karaoke_visible": false,
            "island_locked": true,
            "island_click_through": true,
            "island_pos": [120, 840],
            "island_pos_checked": true,
            "island_hide_when_idle": false,
            "island_scale": 1.2,
            "island_base_width": 750,
            "island_lines": 1,
            "island_font_scale": 1.25,
            "island_show_cover": false,
            "island_cover_circle": true,
            "island_cover_spin": true,
            "island_transparency": 0.75,
            "island_show_on_fullscreen": false
        }"#;
        let dir = std::env::temp_dir().join(format!("lyra-ui-state-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("ui_state.json"), old).unwrap();
        let state = UiStateStore::load(&dir).snapshot();
        std::fs::remove_dir_all(&dir).ok();

        assert!(!state.marquee_visible);
        assert!(state.marquee_locked);
        assert!(state.marquee_click_through);
        assert_eq!(state.marquee_pos, Some((120, 840)));
        assert!(state.marquee_pos_checked);
        assert!(!state.marquee_hide_when_idle);
        assert_eq!(state.marquee_scale, Some(1.2));
        assert_eq!(state.marquee_base_width, 750);
        assert_eq!(state.marquee_lines, 1);
        assert_eq!(state.marquee_font_scale, 1.25);
        assert!(!state.marquee_show_cover);
        assert!(state.marquee_cover_circle);
        assert!(state.marquee_cover_spin);
        assert_eq!(state.marquee_transparency, 0.75);
        assert!(!state.marquee_show_on_fullscreen);

        let saved = serde_json::to_string(&state).unwrap();
        assert!(saved.contains("\"marquee_visible\":false"));
        assert!(!saved.contains("island"));
    }
}
