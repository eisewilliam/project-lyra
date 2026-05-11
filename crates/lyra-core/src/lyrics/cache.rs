use std::path::{Path, PathBuf};

use crate::domain::{LyricDocument, LyricSourceKind};
use crate::lyrics::parser;
use anyhow::Result;

pub struct LyricCache {
    cache_dir: PathBuf,
    override_dir: PathBuf,
}

impl LyricCache {
    pub fn new(app_support_dir: &Path) -> Self {
        Self {
            cache_dir: app_support_dir.join("lyrics_cache"),
            override_dir: app_support_dir.join("lyrics_overrides"),
        }
    }

    pub fn ensure_dirs(&self) -> Result<()> {
        std::fs::create_dir_all(&self.cache_dir)?;
        std::fs::create_dir_all(&self.override_dir)?;
        Ok(())
    }

    pub fn get(&self, track_key: &str) -> Option<LyricDocument> {
        // Manual override takes priority
        let override_path = self.override_dir.join(Self::filename(track_key));
        if override_path.exists() {
            if let Ok(raw) = std::fs::read_to_string(&override_path) {
                if let Ok(doc) = parser::parse_lrc(track_key, &raw, LyricSourceKind::ManualOverride) {
                    return Some(doc);
                }
            }
        }

        let cache_path = self.cache_dir.join(Self::filename(track_key));
        if cache_path.exists() {
            if let Ok(raw) = std::fs::read_to_string(&cache_path) {
                if let Ok(doc) = parser::parse_lrc(track_key, &raw, LyricSourceKind::Lrclib) {
                    return Some(doc);
                }
            }
        }

        None
    }

    pub fn put(&self, track_key: &str, raw_lrc: &str) -> Result<()> {
        let path = self.cache_dir.join(Self::filename(track_key));
        std::fs::write(path, raw_lrc)?;
        Ok(())
    }

    /// Sentinel file marking a known-missing track so we skip LRCLIB retries.
    pub fn mark_negative(&self, track_key: &str) -> Result<()> {
        let path = self.cache_dir.join(format!("{}.nomatch", Self::stem(track_key)));
        std::fs::write(path, "")?;
        Ok(())
    }

    pub fn is_negative(&self, track_key: &str) -> bool {
        self.cache_dir.join(format!("{}.nomatch", Self::stem(track_key))).exists()
    }

    fn filename(track_key: &str) -> String {
        format!("{}.lrc", Self::stem(track_key))
    }

    fn stem(track_key: &str) -> String {
        urlencoding::encode(track_key).to_string()
    }
}
