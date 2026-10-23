use std::path::{Path, PathBuf};

use crate::domain::{LyricDocument, LyricSourceKind};
use crate::lyrics::parser;
use anyhow::Result;

const DAY_SECS: u64 = 24 * 60 * 60;
/// How long a `.nomatch` sentinel is trusted, by how many lookups in a row
/// have missed. LRCLIB gains lyrics daily, so a new release that misses today
/// is checked again tomorrow; a track that keeps missing waits longer.
const NEGATIVE_TTL_SECS: [u64; 4] = [DAY_SECS, 3 * DAY_SECS, 7 * DAY_SECS, 14 * DAY_SECS];
/// Bumped when lookups improve, so earlier misses are looked up again.
const NEGATIVE_CACHE_VERSION: &str = "v4";

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

        let plain_path = self
            .cache_dir
            .join(format!("{}.txt", Self::stem(track_key)));
        let plain = std::fs::read_to_string(plain_path).ok()?;
        if plain.trim().is_empty() {
            return None;
        }
        Some(LyricDocument {
            track_key: track_key.to_owned(),
            source: LyricSourceKind::Lrclib,
            lines: vec![],
            raw_lrc: String::new(),
            plain_lyrics: Some(plain),
        })
    }

    /// True when synced, plain or user-supplied lyrics exist for the track.
    /// Cheaper than `get`: checks files without reading them.
    pub fn has_lyrics(&self, track_key: &str) -> bool {
        self.override_dir.join(Self::filename(track_key)).exists()
            || self.cache_dir.join(Self::filename(track_key)).exists()
            || self
                .cache_dir
                .join(format!("{}.txt", Self::stem(track_key)))
                .exists()
    }

    pub fn put_document(&self, doc: &LyricDocument) -> Result<()> {
        if let Some(plain) = doc.plain_lyrics.as_ref().filter(|_| doc.lines.is_empty()) {
            std::fs::create_dir_all(&self.cache_dir)?;
            std::fs::write(
                self.cache_dir
                    .join(format!("{}.txt", Self::stem(&doc.track_key))),
                plain,
            )?;
            let timed_path = self.cache_dir.join(Self::filename(&doc.track_key));
            if timed_path.exists() {
                std::fs::remove_file(timed_path)?;
            }
        } else {
            self.put(&doc.track_key, &doc.raw_lrc)?;
            let plain_path = self
                .cache_dir
                .join(format!("{}.txt", Self::stem(&doc.track_key)));
            if plain_path.exists() {
                std::fs::remove_file(plain_path)?;
            }
        }
        self.clear_negative(&doc.track_key)?;
        Ok(())
    }

    pub fn put(&self, track_key: &str, raw_lrc: &str) -> Result<()> {
        std::fs::create_dir_all(&self.cache_dir)?;
        let path = self.cache_dir.join(Self::filename(track_key));
        std::fs::write(path, raw_lrc)?;
        Ok(())
    }

    /// Sentinel file marking a known-missing track so we skip LRCLIB retries.
    /// Records how many lookups in a row have missed.
    pub fn mark_negative(&self, track_key: &str) -> Result<()> {
        std::fs::create_dir_all(&self.cache_dir)?;
        let path = self.negative_path(track_key);
        let misses = Self::negative_misses(&path).unwrap_or(0).saturating_add(1);
        std::fs::write(path, format!("{NEGATIVE_CACHE_VERSION} {misses}"))?;
        Ok(())
    }

    /// True while the track's last miss is recent enough to trust. An expired
    /// sentinel stays on disk so a repeat miss is trusted for longer.
    pub fn is_negative(&self, track_key: &str) -> bool {
        let path = self.negative_path(track_key);
        let Some(misses) = Self::negative_misses(&path) else {
            return false;
        };
        let ttl = NEGATIVE_TTL_SECS[(misses as usize - 1).min(NEGATIVE_TTL_SECS.len() - 1)];
        std::fs::metadata(&path)
            .and_then(|meta| meta.modified())
            .ok()
            .and_then(|modified| modified.elapsed().ok())
            .is_some_and(|age| age.as_secs() < ttl)
    }

    /// Misses recorded by the sentinel at `path`, at least 1. Sentinels from
    /// another version are removed.
    fn negative_misses(path: &Path) -> Option<u32> {
        let raw = std::fs::read_to_string(path).ok()?;
        let mut fields = raw.split_whitespace();
        if fields.next() != Some(NEGATIVE_CACHE_VERSION) {
            let _ = std::fs::remove_file(path);
            return None;
        }
        let misses = fields.next().and_then(|n| n.parse().ok()).unwrap_or(1);
        Some(u32::max(misses, 1))
    }

    fn negative_path(&self, track_key: &str) -> PathBuf {
        self.cache_dir
            .join(format!("{}.nomatch", Self::stem(track_key)))
    }

    /// Remove the negative sentinel for a track so the next refresh attempt
    /// re-queries the upstream provider. Used by the manual-retry flow.
    pub fn clear_negative(&self, track_key: &str) -> Result<()> {
        let path = self.negative_path(track_key);
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
    fn plain_cache_roundtrips_without_timing_and_manual_override_wins() {
        let (cache, path) = tmp_cache();
        let key = "spotify:track:plain";
        let doc = LyricDocument {
            track_key: key.into(),
            source: LyricSourceKind::Lrclib,
            lines: vec![],
            raw_lrc: String::new(),
            plain_lyrics: Some("First\n\nLast".into()),
        };
        cache.mark_negative(key).unwrap();
        cache.put_document(&doc).unwrap();
        assert!(!cache.is_negative(key));
        let read = cache.get(key).unwrap();
        assert_eq!(read.plain_lyrics, doc.plain_lyrics);
        assert!(read.lines.is_empty());
        std::fs::write(
            path.as_path()
                .join("lyrics_overrides")
                .join(LyricCache::filename(key)),
            "[00:01.00]Override",
        )
        .unwrap();
        let read = cache.get(key).unwrap();
        assert_eq!(read.lines[0].text, "Override");
        assert!(read.plain_lyrics.is_none());
    }

    #[test]
    fn fresh_negative_marker_is_active() {
        let (cache, _t) = tmp_cache();
        cache.mark_negative("spotify:track:abc").unwrap();
        assert!(cache.is_negative("spotify:track:abc"));
    }

    fn age_negative(cache: &LyricCache, key: &str, days: u64) {
        let aged = SystemTime::now() - Duration::from_secs(days * DAY_SECS + 60);
        std::fs::File::options()
            .write(true)
            .open(cache.negative_path(key))
            .unwrap()
            .set_modified(aged)
            .unwrap();
    }

    #[test]
    fn repeated_misses_are_trusted_for_longer() {
        let (cache, _t) = tmp_cache();
        let key = "spotify:track:expired";
        cache.mark_negative(key).unwrap();
        age_negative(&cache, key, 1);
        assert!(
            !cache.is_negative(key),
            "a first miss is checked again after a day"
        );

        cache.mark_negative(key).unwrap();
        age_negative(&cache, key, 1);
        assert!(cache.is_negative(key), "a second miss waits three days");
        age_negative(&cache, key, 3);
        assert!(!cache.is_negative(key));

        for _ in 0..10 {
            cache.mark_negative(key).unwrap();
        }
        age_negative(&cache, key, 13);
        assert!(cache.is_negative(key), "the wait tops out at two weeks");
        age_negative(&cache, key, 14);
        assert!(!cache.is_negative(key));
    }

    #[test]
    fn clear_negative_removes_sentinel() {
        let (cache, _t) = tmp_cache();
        cache.mark_negative("spotify:track:xyz").unwrap();
        assert!(cache.is_negative("spotify:track:xyz"));
        cache.clear_negative("spotify:track:xyz").unwrap();
        assert!(!cache.is_negative("spotify:track:xyz"));
    }

    #[test]
    fn legacy_negative_marker_is_purged() {
        let (cache, _t) = tmp_cache();
        let key = "spotify:track:legacy";
        let path = cache.negative_path(key);
        for legacy in ["", "v3"] {
            std::fs::write(&path, legacy).unwrap();
            assert!(!cache.is_negative(key));
            assert!(!path.exists(), "legacy sentinel must be removed");
        }
    }
}

// Tiny standalone temp-dir helper so we don't pull in `tempfile` just for tests.
#[cfg(test)]
mod tempdir_like {
    use std::path::{Path, PathBuf};

    pub struct TempPath(PathBuf);

    impl TempPath {
        pub fn new() -> Self {
            // The clock alone collides when parallel tests start within the
            // same microsecond (macOS resolution); one test's Drop would then
            // delete the other's directory mid-run.
            static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
            let seq = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            let nanos = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let pid = std::process::id();
            let path = std::env::temp_dir().join(format!("lyra-cache-test-{pid}-{nanos}-{seq}"));
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
