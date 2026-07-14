use std::path::{Path, PathBuf};

use crate::domain::{LyricDocument, LyricSourceKind, NotFoundReason};
use crate::lyrics::parser;
use anyhow::Result;

/// Negative cache entries expire after this many seconds. A track marked
/// `.nomatch` will be re-fetched once the sentinel file is older than this —
/// covers the case where LRCLib gains lyrics for a track after a first miss.
const NEGATIVE_TTL_SECS: u64 = 14 * 24 * 60 * 60;
const NEGATIVE_CACHE_VERSION: &str = "v2";

#[derive(Clone)]
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
                if let Ok(doc) = parser::parse_lrc(track_key, &raw, LyricSourceKind::ManualOverride)
                {
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
        std::fs::create_dir_all(&self.cache_dir)?;
        let path = self.cache_dir.join(Self::filename(track_key));
        std::fs::write(path, raw_lrc)?;
        Ok(())
    }

    /// Sentinel file marking a known-missing track so we skip LRCLIB retries.
    pub fn mark_negative(&self, track_key: &str, reason: NotFoundReason) -> Result<()> {
        std::fs::create_dir_all(&self.cache_dir)?;
        let path = self
            .cache_dir
            .join(format!("{}.nomatch", Self::stem(track_key)));
        let content = match reason {
            NotFoundReason::Miss => "miss",
            NotFoundReason::NetworkError => "network_error",
            NotFoundReason::RateLimit => "rate_limit",
            NotFoundReason::Instrumental => "instrumental",
            NotFoundReason::Classical => "classical",
            NotFoundReason::Soundtrack => "soundtrack",
        };
        std::fs::write(path, content)?;
        Ok(())
    }

    pub fn is_negative(&self, track_key: &str) -> bool {
        let path = self
            .cache_dir
            .join(format!("{}.nomatch", Self::stem(track_key)));
        let Ok(meta) = std::fs::metadata(&path) else {
            return false;
        };
        match std::fs::read_to_string(&path) {
            Ok(content) => {
                let trimmed = content.trim();
                let valid = trimmed == NEGATIVE_CACHE_VERSION
                    || trimmed == "miss"
                    || trimmed == "network_error"
                    || trimmed == "rate_limit"
                    || trimmed == "instrumental"
                    || trimmed == "classical"
                    || trimmed == "soundtrack";
                if !valid {
                    let _ = std::fs::remove_file(&path);
                    return false;
                }
            }
            _ => {
                let _ = std::fs::remove_file(&path);
                return false;
            }
        }
        let Ok(modified) = meta.modified() else {
            return false;
        };
        match modified.elapsed() {
            Ok(age) if age.as_secs() < NEGATIVE_TTL_SECS => true,
            _ => {
                let _ = std::fs::remove_file(&path);
                false
            }
        }
    }

    pub fn get_negative_reason(&self, track_key: &str) -> Option<NotFoundReason> {
        let path = self
            .cache_dir
            .join(format!("{}.nomatch", Self::stem(track_key)));
        let Ok(meta) = std::fs::metadata(&path) else {
            return None;
        };

        // Check age first
        if let Ok(modified) = meta.modified() {
            if let Ok(age) = modified.elapsed() {
                if age.as_secs() >= NEGATIVE_TTL_SECS {
                    let _ = std::fs::remove_file(&path);
                    return None;
                }
            }
        }

        match std::fs::read_to_string(&path) {
            Ok(content) => match content.trim() {
                "instrumental" => Some(NotFoundReason::Instrumental),
                "classical" => Some(NotFoundReason::Classical),
                "soundtrack" => Some(NotFoundReason::Soundtrack),
                "network_error" => Some(NotFoundReason::NetworkError),
                "rate_limit" => Some(NotFoundReason::RateLimit),
                _ => Some(NotFoundReason::Miss),
            },
            _ => None,
        }
    }

    /// Remove the negative sentinel for a track so the next refresh attempt
    /// re-queries the upstream provider. Used by the manual-retry flow.
    pub fn clear_negative(&self, track_key: &str) -> Result<()> {
        let path = self
            .cache_dir
            .join(format!("{}.nomatch", Self::stem(track_key)));
        if path.exists() {
            std::fs::remove_file(path)?;
        }
        Ok(())
    }

    /// Clear all cached lyrics and negative sentinels, except overrides.
    pub fn clear(&self) -> Result<()> {
        if self.cache_dir.exists() {
            std::fs::remove_dir_all(&self.cache_dir)?;
            std::fs::create_dir_all(&self.cache_dir)?;
        }
        Ok(())
    }

    fn filename(track_key: &str) -> String {
        format!("{}.lrc", Self::stem(track_key))
    }

    fn stem(track_key: &str) -> String {
        urlencoding::encode(track_key).to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, SystemTime};

    fn tmp_cache() -> (LyricCache, tempdir_like::TempPath) {
        let path = tempdir_like::TempPath::new();
        let cache = LyricCache::new(path.as_path());
        cache.ensure_dirs().unwrap();
        (cache, path)
    }

    #[test]
    fn fresh_negative_marker_is_active() {
        let (cache, _t) = tmp_cache();
        cache.mark_negative("spotify:track:abc", NotFoundReason::Miss).unwrap();
        assert!(cache.is_negative("spotify:track:abc"));
        assert_eq!(cache.get_negative_reason("spotify:track:abc"), Some(NotFoundReason::Miss));
    }

    #[test]
    fn expired_negative_marker_is_purged() {
        let (cache, t) = tmp_cache();
        let key = "spotify:track:expired";
        cache.mark_negative(key, NotFoundReason::Miss).unwrap();
        let path = t
            .as_path()
            .join("lyrics_cache")
            .join(format!("{}.nomatch", LyricCache::stem(key)));
        let aged = SystemTime::now() - Duration::from_secs(NEGATIVE_TTL_SECS + 60);
        std::fs::File::options()
            .write(true)
            .open(&path)
            .unwrap()
            .set_modified(aged)
            .unwrap();
        assert!(!cache.is_negative(key));
        assert!(!path.exists(), "expired sentinel must be removed");
    }

    #[test]
    fn clear_negative_removes_sentinel() {
        let (cache, _t) = tmp_cache();
        cache.mark_negative("spotify:track:xyz", NotFoundReason::Miss).unwrap();
        assert!(cache.is_negative("spotify:track:xyz"));
        cache.clear_negative("spotify:track:xyz").unwrap();
        assert!(!cache.is_negative("spotify:track:xyz"));
    }

    #[test]
    fn legacy_negative_marker_is_purged() {
        let (cache, t) = tmp_cache();
        let key = "spotify:track:legacy";
        let path = t
            .as_path()
            .join("lyrics_cache")
            .join(format!("{}.nomatch", LyricCache::stem(key)));
        std::fs::write(&path, "").unwrap();

        assert!(!cache.is_negative(key));
        assert!(!path.exists(), "legacy sentinel must be removed");
    }
}

// Tiny standalone temp-dir helper so we don't pull in `tempfile` just for tests.
#[cfg(test)]
mod tempdir_like {
    use std::path::{Path, PathBuf};

    pub struct TempPath(PathBuf);

    impl TempPath {
        pub fn new() -> Self {
            let nanos = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path = std::env::temp_dir().join(format!("lyra-cache-test-{nanos}"));
            std::fs::create_dir_all(&path).unwrap();
            Self(path)
        }
        pub fn as_path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TempPath {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
}
