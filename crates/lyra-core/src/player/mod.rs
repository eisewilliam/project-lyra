#[cfg(target_os = "macos")]
pub mod spotify_macos;

#[cfg(target_os = "linux")]
pub mod spotify_linux;

#[cfg(target_os = "windows")]
pub mod spotify_windows;

use crate::domain::{PlaybackSnapshot, PlayerSource};
use crate::events::PlayerEvent;

pub trait PlayerAdapter: Send + Sync {
    fn name(&self) -> &str;
    fn source(&self) -> PlayerSource;
    fn snapshot(&self) -> Option<PlaybackSnapshot>;
    fn poll(&self) -> Option<PlayerEvent>;
}
