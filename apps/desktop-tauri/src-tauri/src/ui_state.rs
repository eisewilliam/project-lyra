use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct UiState {
    #[serde(default = "default_true")]
    pub island_visible: bool,
    #[serde(default = "default_true")]
    pub floating_visible: bool,
    #[serde(default)]
    pub karaoke_visible: bool,
    #[serde(default = "default_true")]
    pub island_locked: bool,
    #[serde(default)]
    pub island_pos: Option<(i32, i32)>,
    /// Physical pixels — None means use the tauri.conf.json defaults.
    #[serde(default)]
    pub island_width: Option<u32>,
    #[serde(default)]
    pub island_height: Option<u32>,

    #[serde(default = "default_font_scale")]
    pub island_font_scale: f32,
    #[serde(default = "default_font_scale")]
    pub karaoke_font_scale: f32,
    #[serde(default = "default_font_scale")]
    pub floating_font_scale: f32,

    #[serde(default = "default_true")]
    pub island_show_cover: bool,
    #[serde(default)]
    pub island_cover_circle: bool,
    #[serde(default)]
    pub island_cover_spin: bool,

    #[serde(default = "default_true")]
    pub island_show_on_fullscreen: bool,
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
}

fn default_true() -> bool { true }
fn default_font_scale() -> f32 { 1.0 }
fn default_theme() -> String { "auto".into() }
fn default_karaoke_position() -> String { "bottom".into() }
fn default_karaoke_alignment() -> String { "center".into() }
fn default_karaoke_width_pct() -> u32 { 100 }
fn default_karaoke_offset_px() -> u32 { 24 }
fn default_karaoke_lines() -> u8 { 2 }

impl Default for UiState {
    fn default() -> Self {
        Self {
            island_visible: true,
            floating_visible: true,
            karaoke_visible: false,
            island_locked: true,
            island_pos: None,
            island_width: None,
            island_height: None,
            island_font_scale: 1.0,
            karaoke_font_scale: 1.0,
            floating_font_scale: 1.0,
            island_show_cover: true,
            island_cover_circle: false,
            island_cover_spin: false,
            island_show_on_fullscreen: true,
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
        }
    }
}

pub struct UiStateStore {
    path: PathBuf,
    inner: Mutex<UiState>,
}

impl UiStateStore {
    pub fn load(dir: &PathBuf) -> Self {
        let path = dir.join("ui_state.json");
        let state = std::fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str::<UiState>(&s).ok())
            .unwrap_or_default();
        Self {
            path,
            inner: Mutex::new(state),
        }
    }

    pub fn snapshot(&self) -> UiState {
        self.inner.lock().unwrap().clone()
    }

    pub fn mutate<F: FnOnce(&mut UiState)>(&self, f: F) -> UiState {
        let mut guard = self.inner.lock().unwrap();
        f(&mut *guard);
        let snap = guard.clone();
        drop(guard);
        self.save(&snap);
        snap
    }

    fn save(&self, state: &UiState) {
        if let Some(parent) = self.path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Ok(json) = serde_json::to_string_pretty(state) {
            let _ = std::fs::write(&self.path, json);
        }
    }
}
