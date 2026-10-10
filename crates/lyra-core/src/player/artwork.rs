//! In-memory store for artwork that players expose only as bytes.
//!
//! Playback ticks are emitted several times a second, so they carry a short
//! URL instead of an inline `data:` image. The host serves `get` through a
//! custom URI scheme whose base URL it supplies.

use std::collections::hash_map::DefaultHasher;
use std::collections::VecDeque;
use std::hash::{Hash, Hasher};
use std::sync::{Arc, Mutex};

use super::ArtworkBytes;

/// Covers the current track plus recent history across surfaces without
/// holding many full-size images in memory.
const CAPACITY: usize = 8;

#[derive(Debug, Clone)]
pub struct ArtworkBlob {
    pub mime: &'static str,
    pub data: Arc<[u8]>,
}

pub struct ArtworkStore {
    base_url: String,
    entries: Mutex<VecDeque<(String, ArtworkBlob)>>,
}

impl ArtworkStore {
    /// `base_url` must end with `/`; ids are appended to it.
    pub fn new(base_url: impl Into<String>) -> Self {
        Self {
            base_url: base_url.into(),
            entries: Mutex::new(VecDeque::with_capacity(CAPACITY)),
        }
    }

    /// Store the image if it is new and return the URL surfaces should load.
    /// Same key and size yield the same URL without rehashing image bytes.
    pub fn publish(&self, artwork: &ArtworkBytes) -> String {
        let id = artwork_id(&artwork.key, artwork.data.len());
        let mut entries = self.entries.lock().unwrap_or_else(|e| e.into_inner());
        if !entries.iter().any(|(existing, _)| *existing == id) {
            if entries.len() == CAPACITY {
                entries.pop_front();
            }
            entries.push_back((
                id.clone(),
                ArtworkBlob {
                    mime: artwork.mime,
                    data: Arc::clone(&artwork.data),
                },
            ));
        }
        format!("{}{}", self.base_url, id)
    }

    pub fn get(&self, id: &str) -> Option<ArtworkBlob> {
        self.entries
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .iter()
            .find(|(existing, _)| existing == id)
            .map(|(_, blob)| blob.clone())
    }
}

fn artwork_id(key: &str, len: usize) -> String {
    let mut hasher = DefaultHasher::new();
    key.hash(&mut hasher);
    len.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn art(key: &str, bytes: &[u8]) -> ArtworkBytes {
        ArtworkBytes {
            key: key.into(),
            mime: "image/png",
            data: Arc::from(bytes),
        }
    }

    #[test]
    fn publish_is_idempotent_and_servable() {
        let store = ArtworkStore::new("lyra-art://localhost/");
        let url = store.publish(&art("track", b"png"));
        assert_eq!(url, store.publish(&art("track", b"png")));
        let id = url.strip_prefix("lyra-art://localhost/").unwrap();
        let blob = store.get(id).unwrap();
        assert_eq!(&*blob.data, b"png");
        assert_eq!(blob.mime, "image/png");
    }

    #[test]
    fn oldest_entries_are_evicted() {
        let store = ArtworkStore::new("x/");
        let first = store.publish(&art("first", b"1"));
        for i in 0..CAPACITY {
            store.publish(&art(&format!("next-{i}"), b"2"));
        }
        assert!(store.get(first.strip_prefix("x/").unwrap()).is_none());
    }
}
