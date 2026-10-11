//! Player observation and control.
//!
//! Adapters (one per OS transport) report every playback session they can
//! see. `PlayerHub` merges those observations, lets `registry` choose the
//! session Lyra follows, and routes playback commands back to the adapter
//! that owns it. Supported players per OS are tracked in
//! `docs/PLAYER_SUPPORT.md`.

pub mod artwork;
pub mod classify;
pub mod hub;
pub mod known;
pub mod metadata;
pub mod policy;
pub mod registry;

#[cfg(target_os = "macos")]
pub mod apple_music_macos;
#[cfg(target_os = "macos")]
mod applescript;
#[cfg(target_os = "macos")]
pub use applescript::{automation_denied, set_automation_enabled};
#[cfg(target_os = "macos")]
pub mod mediaremote_macos;
#[cfg(target_os = "macos")]
pub mod spotify_macos;

#[cfg(target_os = "linux")]
pub mod mpris_linux;

#[cfg(target_os = "windows")]
pub mod smtc_windows;

use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::domain::{PlaybackSnapshot, Transport};

/// One playback session as seen by one adapter at one instant.
#[derive(Debug, Clone)]
pub struct SessionObservation {
    /// Stable identifier, unique across adapters. Prefix it with the
    /// transport so two transports can report the same app.
    pub id: String,
    /// `snapshot.track.artwork_url` carries remote URLs only; artwork bytes
    /// travel in `artwork` and are published by the hub.
    pub snapshot: PlaybackSnapshot,
    pub artwork: Option<ArtworkBytes>,
    /// The OS marks this as its current media session.
    pub os_current: bool,
}

/// Artwork the player only exposes as raw image data.
#[derive(Debug, Clone)]
pub struct ArtworkBytes {
    /// Identifies the image so the hub can skip re-publishing it on every
    /// poll; typically the track key.
    pub key: String,
    pub mime: &'static str,
    pub data: Arc<[u8]>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlayerCommand {
    PlayPause,
    Next,
    Previous,
    SeekMs(u64),
    /// Bring the player to the front, showing the current track where the
    /// player allows it.
    Raise,
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum ControlError {
    #[error("no active player")]
    NoSession,
    #[error("the player does not support this control")]
    Unsupported,
    #[error("the player did not accept the command")]
    Failed,
}

pub trait PlayerAdapter: Send + Sync {
    fn transport(&self) -> Transport;

    /// Every session this adapter can currently see. Blocking OS calls are
    /// allowed; callers must not hold the runtime lock. On a transient
    /// failure, return the last known sessions rather than an empty list.
    fn sessions(&self) -> Vec<SessionObservation>;

    fn control(&self, session_id: &str, command: PlayerCommand) -> Result<(), ControlError>;

    /// Stop background work (helper processes) before the app exits.
    fn shutdown(&self) {}
}

pub(crate) fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Mime type from image magic bytes; players rarely label artwork.
pub(crate) fn sniff_image_mime(data: &[u8]) -> &'static str {
    if data.starts_with(&[0x89, 0x50, 0x4E, 0x47]) {
        "image/png"
    } else if data.starts_with(b"GIF8") {
        "image/gif"
    } else if data.len() > 12 && &data[0..4] == b"RIFF" && &data[8..12] == b"WEBP" {
        "image/webp"
    } else {
        "image/jpeg"
    }
}

/// Run `/usr/bin/open` (Launch Services) with the given arguments: opens a
/// URL in its handler app or activates an app by bundle ID (`-b`).
#[cfg(target_os = "macos")]
pub(crate) fn macos_open(args: &[&str]) -> bool {
    std::process::Command::new("/usr/bin/open")
        .args(args)
        .env_clear()
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .is_ok_and(|status| status.success())
}
