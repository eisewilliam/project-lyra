use std::path::{Path, PathBuf};

use crate::domain::SettingsSnapshot;
use anyhow::Result;

pub struct ConfigStore {
    path: PathBuf,
}

impl ConfigStore {
    pub fn new(app_support_dir: &Path) -> Self {
        Self {
            path: app_support_dir.join("config.json"),
        }
    }

    pub fn load(&self) -> SettingsSnapshot {
        std::fs::read_to_string(&self.path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, settings: &SettingsSnapshot) -> Result<()> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let json = serde_json::to_string_pretty(settings)?;
        std::fs::write(&self.path, json)?;
        Ok(())
    }
}
