pub mod cache;
pub mod genius;
pub mod heuristics;
pub mod lrclib;
pub mod offsets;
pub mod parser;

use crate::domain::{LyricDocument, TrackRef};
use anyhow::Result;

pub enum LyricFetchResult {
    Found(LyricDocument),
    Instrumental,
    NotFound,
}

pub trait LyricSource: Send + Sync {
    fn name(&self) -> &str;
    fn fetch(
        &self,
        track: &TrackRef,
    ) -> impl std::future::Future<Output = Result<LyricFetchResult>> + Send;
}
