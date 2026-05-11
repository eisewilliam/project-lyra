use crate::domain::{PlaybackState, RenderSnapshot, SettingsSnapshot, TrackRef};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum PlayerEvent {
    TrackChanged(TrackRef),
    StateChanged(PlaybackState),
    PositionJumped(u64),
    PlayerStopped,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload")]
pub enum CoreEvent {
    RenderUpdated(RenderSnapshot),
    SettingsUpdated(SettingsSnapshot),
    Error { message: String, recoverable: bool },
}
