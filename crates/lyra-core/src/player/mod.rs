pub mod spotify_macos;

use crate::domain::{PlaybackSnapshot, PlayerSource};
use crate::events::PlayerEvent;

pub trait PlayerAdapter: Send + Sync {
    fn name(&self) -> &str;
    fn source(&self) -> PlayerSource;
    fn snapshot(&self) -> Option<PlaybackSnapshot>;
    fn poll(&self) -> Option<PlayerEvent>;
}
