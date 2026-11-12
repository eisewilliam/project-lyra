pub mod cache;
pub mod lrclib;
pub mod offsets;
pub mod parser;
pub mod refresh;

use crate::domain::{LyricDocument, TrackRef};
use anyhow::Result;

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
}
