use std::collections::HashMap;
use std::path::{Path, PathBuf};

use anyhow::Result;

/// Per-track manual lyric timing offset, in milliseconds.
///
/// A **positive** offset *delays* the lyrics (they appear later relative to the
/// audio); a **negative** offset advances them. Offsets are keyed by track URI
/// and persisted to a single JSON map so a user's correction survives restarts
/// and re-applies whenever the same track plays again.
#[derive(Clone)]
pub struct OffsetStore {
    path: PathBuf,
    offsets: HashMap<String, i64>,
}

impl OffsetStore {
    pub fn new(app_support_dir: &Path) -> Self {
        let path = app_support_dir.join("lyric_offsets.json");
        let offsets = std::fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str::<HashMap<String, i64>>(&s).ok())
            .unwrap_or_default();
        Self { path, offsets }
    }

    /// Offset for a track, or 0 when none has been set.
    pub fn get(&self, track_key: &str) -> i64 {
        self.offsets.get(track_key).copied().unwrap_or(0)
    }

    /// Set the absolute offset for a track and persist. An offset of 0 removes
    /// the entry so the map doesn't accumulate no-op records.
    pub fn set(&mut self, track_key: &str, offset_ms: i64) {
        self.set_inner(track_key, offset_ms);
        self.save();
    }

    pub fn set_sync(&mut self, track_key: &str, offset_ms: i64) {
        self.set_inner(track_key, offset_ms);
        let _ = self.save_sync();
    }

    fn set_inner(&mut self, track_key: &str, offset_ms: i64) {
        if offset_ms == 0 {
            self.offsets.remove(track_key);
        } else {
            self.offsets.insert(track_key.to_string(), offset_ms);
        }
    }

    fn save(&self) {
        let path = self.path.clone();
        let offsets = self.offsets.clone();
        if let Ok(handle) = tokio::runtime::Handle::try_current() {
            handle.spawn(async move {
                let _ = save_offsets(&path, &offsets);
            });
        } else {
            let _ = save_offsets(&path, &offsets);
        }
    }

    fn save_sync(&self) -> Result<()> {
        save_offsets(&self.path, &self.offsets)
    }
}

fn save_offsets(path: &Path, offsets: &HashMap<String, i64>) -> Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_string(offsets)?;
    std::fs::write(path, json)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_dir() -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("lyra-offset-test-{nanos}"));
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn unset_track_has_zero_offset() {
        let store = OffsetStore::new(&tmp_dir());
        assert_eq!(store.get("spotify:track:abc"), 0);
    }

    #[test]
    fn set_then_get_roundtrips() {
        let dir = tmp_dir();
        let mut store = OffsetStore::new(&dir);
        store.set_sync("spotify:track:abc", 350);
        assert_eq!(store.get("spotify:track:abc"), 350);
        // Re-load from disk to confirm persistence.
        let reloaded = OffsetStore::new(&dir);
        assert_eq!(reloaded.get("spotify:track:abc"), 350);
    }

    #[test]
    fn zero_offset_removes_entry() {
        let dir = tmp_dir();
        let mut store = OffsetStore::new(&dir);
        store.set_sync("spotify:track:abc", 200);
        store.set_sync("spotify:track:abc", 0);
        let reloaded = OffsetStore::new(&dir);
        assert_eq!(reloaded.get("spotify:track:abc"), 0);
    }
}
