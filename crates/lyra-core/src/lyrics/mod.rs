pub mod cache;
mod choice;
pub mod import;
pub mod lrclib;
pub mod offsets;
pub mod parser;
pub mod refresh;

use crate::domain::{LyricCandidate, LyricDocument, LyricSearchQuery, TrackRef};
use anyhow::Result;
use std::hash::{Hash, Hasher};

pub trait LyricSource: Send + Sync {
    fn name(&self) -> &str;
    /// The source answered busy (overloaded or rate limiting) in the last
    /// minute or so. Background lookups wait for that to pass.
    fn is_busy(&self) -> bool {
        false
    }
    fn fetch(
        &self,
        track: &TrackRef,
    ) -> impl std::future::Future<Output = Result<Option<LyricDocument>>> + Send;

    /// Every match the provider has for `query`, best fit for `track` first,
    /// so the user can choose another one.
    fn candidates(
        &self,
        _track: &TrackRef,
        _query: &LyricSearchQuery,
    ) -> impl std::future::Future<Output = Result<Vec<LyricCandidate>>> + Send {
        async { Ok(Vec::new()) }
    }

    /// One match by the ID a candidate carries, as a document for
    /// `track_key`. `Ok(None)` when the provider no longer has it.
    fn fetch_by_id(
        &self,
        _track_key: &str,
        _id: i64,
    ) -> impl std::future::Future<Output = Result<Option<LyricDocument>>> + Send {
        async { Ok(None) }
    }
}

/// Identifies lyric text, to tell whether a candidate is the one showing.
pub fn fingerprint(text: &str) -> u64 {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    text.trim().hash(&mut hasher);
    hasher.finish()
}

/// The fingerprint of the text a document shows: its timed lyrics, or its
/// plain text when it has no timing.
pub fn document_fingerprint(doc: &LyricDocument) -> Option<u64> {
    if doc.lines.is_empty() {
        doc.plain_lyrics.as_deref().map(fingerprint)
    } else {
        Some(fingerprint(&doc.raw_lrc))
    }
}
