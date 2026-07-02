pub mod cache;
pub mod lrclib;
pub mod offsets;
pub mod parser;

use crate::domain::{LyricDocument, TrackRef};
use anyhow::Result;

pub trait LyricSource: Send + Sync {
    fn name(&self) -> &str;
    fn fetch(
        &self,
        track: &TrackRef,
    ) -> impl std::future::Future<Output = Result<Option<LyricDocument>>> + Send;
}
