//! Maps the followed playback session to a Discord activity.

use serde::Serialize;

use crate::domain::{PlaybackSnapshot, PlaybackState, PositionQuality, TrackRef};

/// Discord activity type "Listening": shown as "Listening to …" with a
/// progress bar when both timestamps are present.
const TYPE_LISTENING: u8 = 2;
/// `status_display_type` value that puts `details` (the track title) in the
/// one-line status under the user's name, rather than the application name.
const DISPLAY_DETAILS: u8 = 2;
/// Discord rejects `details` and `state` outside 2–128 characters.
const MIN_TEXT_CHARS: usize = 2;
const MAX_TEXT_CHARS: usize = 128;
/// A start time this far from the published one means the user seeked;
/// anything smaller is extrapolation jitter and is not worth an update.
const SEEK_TOLERANCE_MS: u64 = 3_000;
/// Discord's bar assumes normal speed, so timestamps are left out otherwise.
const NORMAL_RATE: std::ops::RangeInclusive<f64> = 0.98..=1.02;

/// A link shown as a button on the activity.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ActivityButton {
    /// 1–32 characters.
    pub label: String,
    /// 1–512 characters.
    pub url: String,
}

#[derive(Debug, Clone, Default)]
pub struct ActivityOptions {
    /// Publish Spotify playback too. Off by default: Discord already shows
    /// Spotify for linked accounts, so the same song would appear twice.
    pub include_spotify: bool,
    pub button: Option<ActivityButton>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Activity {
    #[serde(rename = "type")]
    kind: u8,
    status_display_type: u8,
    details: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    state: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    timestamps: Option<Timestamps>,
    #[serde(skip_serializing_if = "Option::is_none")]
    assets: Option<Assets>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    buttons: Vec<ActivityButton>,
}

/// Unix milliseconds.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
struct Timestamps {
    start: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    end: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
struct Assets {
    #[serde(skip_serializing_if = "Option::is_none")]
    large_image: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    large_text: Option<String>,
}

impl Activity {
    /// The activity Discord should show for `snapshot`, or `None` to show
    /// nothing: only a playing, followed track is published.
    pub fn for_snapshot(
        snapshot: &PlaybackSnapshot,
        now_ms: u64,
        options: &ActivityOptions,
    ) -> Option<Self> {
        if snapshot.state != PlaybackState::Playing {
            return None;
        }
        let track = snapshot.track.as_ref()?;
        if track.title.trim().is_empty() {
            return None;
        }
        if !options.include_spotify && is_spotify(track) {
            return None;
        }

        let artwork = track
            .artwork_url
            .as_deref()
            // Discord fetches the image itself, so only public URLs work;
            // artwork Lyra holds as bytes is served on a local-only scheme.
            .filter(|url| url.starts_with("https://"))
            .map(str::to_owned);
        let album = track
            .album
            .as_deref()
            .map(str::trim)
            .filter(|album| !album.is_empty())
            .map(fit_text);
        let assets = (artwork.is_some() || album.is_some()).then_some(Assets {
            large_image: artwork,
            large_text: album,
        });

        Some(Self {
            kind: TYPE_LISTENING,
            status_display_type: DISPLAY_DETAILS,
            details: fit_text(track.title.trim()),
            state: Some(track.artist.trim())
                .filter(|artist| !artist.is_empty())
                .map(fit_text),
            timestamps: timestamps(snapshot, track, now_ms),
            assets,
            buttons: options.button.iter().cloned().collect(),
        })
    }

    /// Whether the player supplied artwork Discord can fetch.
    pub(crate) fn has_cover(&self) -> bool {
        self.assets
            .as_ref()
            .is_some_and(|assets| assets.large_image.is_some())
    }

    /// Use `url`, a public `https` image, as the cover.
    pub(crate) fn set_cover(&mut self, url: String) {
        self.assets
            .get_or_insert(Assets {
                large_image: None,
                large_text: None,
            })
            .large_image = Some(url);
    }

    /// True when Discord would show the same thing for both: equal apart
    /// from a start time within the seek tolerance.
    pub(crate) fn same_display(&self, other: &Self) -> bool {
        let starts_match = match (self.timestamps, other.timestamps) {
            (Some(a), Some(b)) => {
                a.start.abs_diff(b.start) <= SEEK_TOLERANCE_MS && a.end.is_some() == b.end.is_some()
            }
            (None, None) => true,
            _ => false,
        };
        starts_match
            && Self {
                timestamps: None,
                ..self.clone()
            } == Self {
                timestamps: None,
                ..other.clone()
            }
    }
}

fn timestamps(snapshot: &PlaybackSnapshot, track: &TrackRef, now_ms: u64) -> Option<Timestamps> {
    if snapshot.position_quality == PositionQuality::Missing
        || !NORMAL_RATE.contains(&snapshot.rate)
    {
        return None;
    }
    let position = snapshot.position_ms?;
    let start = now_ms.checked_sub(position)?;
    // A position past the end means the duration is not known yet.
    let end =
        (track.duration_ms > 0 && position <= track.duration_ms).then(|| start + track.duration_ms);
    Some(Timestamps { start, end })
}

/// Spotify in any form: the desktop app, a third-party client, or the web
/// player in a browser.
fn is_spotify(track: &TrackRef) -> bool {
    track.player.id.to_ascii_lowercase().contains("spotify")
        || track
            .platform
            .as_deref()
            .is_some_and(|platform| platform.eq_ignore_ascii_case("spotify"))
}

/// Fit text into Discord's 2–128 character limit.
fn fit_text(text: &str) -> String {
    let count = text.chars().count();
    if count > MAX_TEXT_CHARS {
        let mut cut: String = text.chars().take(MAX_TEXT_CHARS - 1).collect();
        cut.push('…');
        cut
    } else if count < MIN_TEXT_CHARS {
        // Pad one-character titles with a blank Discord does not trim.
        format!("{text}\u{2800}")
    } else {
        text.to_owned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{PlaybackCaps, PlayerApp};

    const NOW: u64 = 1_800_000_000_000;

    fn playing(track: TrackRef, position_ms: u64) -> PlaybackSnapshot {
        PlaybackSnapshot {
            track: Some(track),
            state: PlaybackState::Playing,
            position_ms: Some(position_ms),
            observed_at_ms: NOW,
            rate: 1.0,
            position_quality: PositionQuality::Exact,
            caps: PlaybackCaps::ALL,
            ignored: None,
        }
    }

    fn music_app_track() -> TrackRef {
        TrackRef {
            player: PlayerApp {
                id: "com.apple.Music".into(),
                name: "Music".into(),
            },
            title: "Song".into(),
            artist: "Artist".into(),
            album: Some("Album".into()),
            artwork_url: Some("https://example.com/cover.jpg".into()),
            ..TrackRef::fixture("meta::artist::song::180")
        }
    }

    fn all() -> ActivityOptions {
        ActivityOptions {
            include_spotify: true,
            button: None,
        }
    }

    #[test]
    fn playing_track_becomes_a_listening_activity_with_a_progress_bar() {
        let activity =
            Activity::for_snapshot(&playing(music_app_track(), 30_000), NOW, &all()).unwrap();
        assert_eq!(
            serde_json::to_value(&activity).unwrap(),
            serde_json::json!({
                "type": 2,
                "status_display_type": 2,
                "details": "Song",
                "state": "Artist",
                "timestamps": { "start": NOW - 30_000, "end": NOW - 30_000 + 180_000 },
                "assets": { "large_image": "https://example.com/cover.jpg", "large_text": "Album" },
            })
        );
    }

    #[test]
    fn paused_stopped_and_untitled_playback_show_nothing() {
        let mut paused = playing(music_app_track(), 1_000);
        paused.state = PlaybackState::Paused;
        assert!(Activity::for_snapshot(&paused, NOW, &all()).is_none());
        assert!(Activity::for_snapshot(&PlaybackSnapshot::stopped(NOW), NOW, &all()).is_none());
        let untitled = TrackRef {
            title: "  ".into(),
            ..music_app_track()
        };
        assert!(Activity::for_snapshot(&playing(untitled, 0), NOW, &all()).is_none());
    }

    #[test]
    fn spotify_is_left_to_discord_unless_included() {
        let desktop = TrackRef::fixture("spotify:track:1");
        let web = TrackRef {
            player: PlayerApp {
                id: "com.google.Chrome".into(),
                name: "Chrome".into(),
            },
            platform: Some("Spotify".into()),
            ..TrackRef::fixture("meta::a::b::1")
        };
        let defaults = ActivityOptions::default();
        assert!(Activity::for_snapshot(&playing(desktop.clone(), 0), NOW, &defaults).is_none());
        assert!(Activity::for_snapshot(&playing(web, 0), NOW, &defaults).is_none());
        assert!(Activity::for_snapshot(&playing(desktop, 0), NOW, &all()).is_some());
        assert!(Activity::for_snapshot(&playing(music_app_track(), 0), NOW, &defaults).is_some());
    }

    #[test]
    fn local_artwork_and_unknown_timing_are_left_out() {
        let track = TrackRef {
            artwork_url: Some("lyra-art://localhost/abc".into()),
            album: None,
            duration_ms: 0,
            ..music_app_track()
        };
        let mut snapshot = playing(track, 5_000);
        let json = |s: &PlaybackSnapshot| {
            serde_json::to_value(Activity::for_snapshot(s, NOW, &all()).unwrap()).unwrap()
        };
        let value = json(&snapshot);
        assert!(value.get("assets").is_none());
        assert_eq!(
            value["timestamps"],
            serde_json::json!({ "start": NOW - 5_000 })
        );

        snapshot.position_quality = PositionQuality::Missing;
        assert!(json(&snapshot).get("timestamps").is_none());
        snapshot.position_quality = PositionQuality::Exact;
        snapshot.rate = 1.5;
        assert!(json(&snapshot).get("timestamps").is_none());
    }

    #[test]
    fn a_looked_up_cover_fills_in_for_local_artwork() {
        let track = TrackRef {
            artwork_url: Some("lyra-art://localhost/abc".into()),
            ..music_app_track()
        };
        let mut activity = Activity::for_snapshot(&playing(track, 0), NOW, &all()).unwrap();
        assert!(!activity.has_cover());
        let without = activity.clone();

        activity.set_cover("https://example.com/found.jpg".into());
        assert!(activity.has_cover());
        assert!(!activity.same_display(&without), "the cover is a change");
        assert_eq!(
            serde_json::to_value(&activity).unwrap()["assets"],
            serde_json::json!({ "large_image": "https://example.com/found.jpg", "large_text": "Album" })
        );

        let mut no_album = Activity::for_snapshot(
            &playing(
                TrackRef {
                    album: None,
                    artwork_url: None,
                    ..music_app_track()
                },
                0,
            ),
            NOW,
            &all(),
        )
        .unwrap();
        no_album.set_cover("https://example.com/found.jpg".into());
        assert!(no_album.has_cover());
    }

    #[test]
    fn text_is_fitted_to_discords_limits() {
        let track = TrackRef {
            title: "x".repeat(200),
            artist: "U".into(),
            ..music_app_track()
        };
        let activity = Activity::for_snapshot(&playing(track, 0), NOW, &all()).unwrap();
        assert_eq!(activity.details.chars().count(), 128);
        assert!(activity.details.ends_with('…'));
        assert_eq!(activity.state.unwrap().chars().count(), 2);
    }

    #[test]
    fn button_is_included_when_configured() {
        let options = ActivityOptions {
            include_spotify: true,
            button: Some(ActivityButton {
                label: "Get Lyra".into(),
                url: "https://example.com".into(),
            }),
        };
        let activity = Activity::for_snapshot(&playing(music_app_track(), 0), NOW, &options);
        assert_eq!(
            serde_json::to_value(activity.unwrap()).unwrap()["buttons"],
            serde_json::json!([{ "label": "Get Lyra", "url": "https://example.com" }])
        );
    }

    #[test]
    fn only_a_seek_or_a_different_track_counts_as_a_change() {
        let at = |position| {
            Activity::for_snapshot(&playing(music_app_track(), position), NOW, &all()).unwrap()
        };
        assert!(at(30_000).same_display(&at(31_500)), "extrapolation jitter");
        assert!(!at(30_000).same_display(&at(90_000)), "seek");
        let other = TrackRef {
            title: "Other".into(),
            ..music_app_track()
        };
        let other = Activity::for_snapshot(&playing(other, 30_000), NOW, &all()).unwrap();
        assert!(!at(30_000).same_display(&other));
    }
}
