//! Chooses the playback session Lyra follows and decides when a track change
//! is stable enough to publish. Pure: callers pass time in and perform all OS
//! calls before locking the registry.

use std::collections::HashMap;

use crate::domain::{
    FollowRule, IgnoreReason, IgnoredMedia, PlaybackCaps, PlaybackSnapshot, PlaybackState,
    PlayerSessionInfo, TrackRef, Transport,
};

/// A session that starts playing while another one is already playing must
/// keep playing this long before Lyra switches to it. Filters out
/// notification sounds and hover previews.
pub const SWITCH_HYSTERESIS_MS: u64 = 1_500;

/// Number of identical consecutive observations required before a track
/// without a native ID is published. Media sessions often update the title
/// before the artist or duration; publishing early would fetch lyrics for a
/// half-updated track.
const SETTLE_OBSERVATIONS: u32 = 2;

/// One session reported by an adapter during a poll round.
#[derive(Debug, Clone)]
pub struct Candidate {
    pub adapter: usize,
    pub transport: Transport,
    pub id: String,
    pub snapshot: PlaybackSnapshot,
    pub os_current: bool,
    /// Set when policy says not to follow this session (e.g. not music).
    pub ignored: Option<IgnoreReason>,
}

/// The session commands should be routed to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ActiveSession {
    pub adapter: usize,
    pub id: String,
    pub caps: PlaybackCaps,
}

#[derive(Default)]
pub struct SessionRegistry {
    sessions: HashMap<String, Tracked>,
    active: Option<String>,
    published: Option<PlaybackSnapshot>,
    pending: Option<PendingTrack>,
}

struct Tracked {
    candidate: Candidate,
    /// When the session last entered `Playing`; `None` while not playing.
    /// Survives track changes so auto-advance does not count as a new start.
    playing_since: Option<u64>,
    last_played_at: Option<u64>,
}

#[derive(PartialEq)]
struct PendingTrack {
    session: String,
    signature: TrackSignature,
    seen: u32,
}

#[derive(PartialEq)]
struct TrackSignature {
    uri: String,
    title: String,
    artist: String,
    album: Option<String>,
    duration_ms: u64,
}

impl TrackSignature {
    fn of(track: &TrackRef) -> Self {
        Self {
            uri: track.uri.clone(),
            title: track.title.clone(),
            artist: track.artist.clone(),
            album: track.album.clone(),
            duration_ms: track.duration_ms,
        }
    }
}

impl SessionRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Record one poll round and return the snapshot Lyra should display.
    /// Sessions missing from `round` are forgotten.
    pub fn observe(&mut self, now_ms: u64, round: Vec<Candidate>) -> PlaybackSnapshot {
        let mut next: HashMap<String, Tracked> = HashMap::with_capacity(round.len());
        for candidate in round {
            let previous = self.sessions.remove(&candidate.id);
            let playing = candidate.snapshot.state == PlaybackState::Playing;
            let playing_since = match (&previous, playing) {
                (_, false) => None,
                (Some(prev), true) => prev.playing_since.or(Some(now_ms)),
                (None, true) => Some(now_ms),
            };
            let last_played_at = if playing {
                Some(now_ms)
            } else {
                previous.and_then(|prev| prev.last_played_at)
            };
            next.insert(
                candidate.id.clone(),
                Tracked {
                    candidate,
                    playing_since,
                    last_played_at,
                },
            );
        }
        self.sessions = next;
        self.active = self.choose_active(now_ms);

        let observed = self
            .active
            .as_ref()
            .and_then(|id| self.sessions.get(id))
            .map(|tracked| tracked.candidate.snapshot.clone())
            .unwrap_or_else(|| PlaybackSnapshot {
                ignored: self.ignored_now_playing(),
                ..PlaybackSnapshot::stopped(now_ms)
            });
        self.publish(now_ms, observed)
    }

    /// The most recently started ignored session that is playing, so idle
    /// surfaces can say what Lyra is not following and why.
    fn ignored_now_playing(&self) -> Option<IgnoredMedia> {
        self.sessions
            .values()
            .filter_map(|t| {
                let reason = t.candidate.ignored?;
                let track = t.candidate.snapshot.track.as_ref()?;
                Some((t.playing_since?, reason, track))
            })
            .max_by_key(|(since, _, _)| *since)
            .map(|(_, reason, track)| IgnoredMedia {
                track_key: track.uri.clone(),
                title: track.title.clone(),
                artist: track.artist.clone(),
                player: track.player.clone(),
                platform: track.platform.clone(),
                reason,
            })
    }

    /// True while a track change is waiting for stable metadata. The host
    /// polls sooner so the change is not delayed by a slow poll interval.
    pub fn is_settling(&self) -> bool {
        self.pending.is_some()
    }

    pub fn active(&self) -> Option<ActiveSession> {
        let id = self.active.as_ref()?;
        let tracked = self.sessions.get(id)?;
        Some(ActiveSession {
            adapter: tracked.candidate.adapter,
            id: id.clone(),
            caps: tracked.candidate.snapshot.caps,
        })
    }

    /// Diagnostics view of every session seen in the latest round.
    pub fn sessions(&self) -> Vec<PlayerSessionInfo> {
        let mut out: Vec<PlayerSessionInfo> = self
            .sessions
            .values()
            .map(|tracked| {
                let c = &tracked.candidate;
                let track = c.snapshot.track.as_ref();
                PlayerSessionInfo {
                    id: c.id.clone(),
                    player: track.map(|t| t.player.clone()),
                    transport: c.transport,
                    state: c.snapshot.state.clone(),
                    title: track.map(|t| t.title.clone()),
                    artist: track.map(|t| t.artist.clone()),
                    platform: track.and_then(|t| t.platform.clone()),
                    kind: track.map(|t| t.kind),
                    track_key: track.map(|t| t.uri.clone()),
                    ignored: c.ignored,
                    // Policy-owned fields; the hub fills them in.
                    marked_music: None,
                    app_rule: FollowRule::Auto,
                    position_quality: c.snapshot.position_quality,
                    caps: c.snapshot.caps,
                    os_current: c.os_current,
                    active: self.active.as_deref() == Some(c.id.as_str()),
                }
            })
            .collect();
        out.sort_by(|a, b| b.active.cmp(&a.active).then_with(|| a.id.cmp(&b.id)));
        out
    }

    fn choose_active(&self, now_ms: u64) -> Option<String> {
        let has_track =
            |t: &&Tracked| t.candidate.snapshot.track.is_some() && t.candidate.ignored.is_none();
        let current = self
            .active
            .as_ref()
            .and_then(|id| self.sessions.get(id))
            .filter(has_track);
        let current_playing = current.is_some_and(|t| t.playing_since.is_some());

        // Most recently started playing session wins. While the current
        // session is playing, a challenger must outlast the hysteresis window.
        let newest_playing = self
            .sessions
            .values()
            .filter(has_track)
            .filter_map(|t| t.playing_since.map(|since| (since, t)))
            .filter(|(since, t)| {
                !current_playing
                    || Some(t.candidate.id.as_str()) == self.active.as_deref()
                    || now_ms.saturating_sub(*since) >= SWITCH_HYSTERESIS_MS
            })
            .max_by(|(a_since, a), (b_since, b)| {
                a_since
                    .cmp(b_since)
                    .then(a.candidate.os_current.cmp(&b.candidate.os_current))
                    .then_with(|| b.candidate.id.cmp(&a.candidate.id))
            })
            .map(|(_, t)| t);
        if let Some(t) = newest_playing {
            return Some(t.candidate.id.clone());
        }
        // Nothing playing: stay on the current session even when paused.
        if let Some(t) = current {
            return Some(t.candidate.id.clone());
        }
        self.sessions
            .values()
            .filter(has_track)
            .max_by(|a, b| {
                a.candidate
                    .os_current
                    .cmp(&b.candidate.os_current)
                    .then(a.last_played_at.cmp(&b.last_played_at))
                    .then_with(|| b.candidate.id.cmp(&a.candidate.id))
            })
            .map(|t| t.candidate.id.clone())
    }

    fn publish(&mut self, now_ms: u64, observed: PlaybackSnapshot) -> PlaybackSnapshot {
        let published_uri = self
            .published
            .as_ref()
            .and_then(|s| s.track.as_ref())
            .map(|t| t.uri.as_str());
        let unsettled = observed
            .track
            .as_ref()
            .filter(|track| track.native_id.is_none() && Some(track.uri.as_str()) != published_uri);

        if let Some(track) = unsettled {
            let session = self.active.clone().unwrap_or_default();
            let signature = TrackSignature::of(track);
            let seen = match &self.pending {
                Some(p) if p.session == session && p.signature == signature => p.seen + 1,
                _ => 1,
            };
            if seen < SETTLE_OBSERVATIONS {
                self.pending = Some(PendingTrack {
                    session,
                    signature,
                    seen,
                });
                return self
                    .published
                    .clone()
                    .unwrap_or_else(|| PlaybackSnapshot::stopped(now_ms));
            }
        }

        self.pending = None;
        self.published = Some(observed.clone());
        observed
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::PositionQuality;

    fn track(uri: &str, native: bool) -> TrackRef {
        TrackRef {
            native_id: native.then(|| uri.to_string()),
            title: format!("title {uri}"),
            ..TrackRef::fixture(uri)
        }
    }

    fn candidate(id: &str, state: PlaybackState, track: Option<TrackRef>) -> Candidate {
        Candidate {
            adapter: 0,
            transport: Transport::Smtc,
            id: id.into(),
            snapshot: PlaybackSnapshot {
                track,
                state,
                position_ms: Some(0),
                observed_at_ms: 0,
                rate: 1.0,
                position_quality: PositionQuality::Exact,
                caps: PlaybackCaps::ALL,
                ignored: None,
            },
            os_current: false,
            ignored: None,
        }
    }

    fn playing(id: &str, uri: &str) -> Candidate {
        candidate(id, PlaybackState::Playing, Some(track(uri, true)))
    }

    fn paused(id: &str, uri: &str) -> Candidate {
        candidate(id, PlaybackState::Paused, Some(track(uri, true)))
    }

    fn uri(snapshot: &PlaybackSnapshot) -> Option<&str> {
        snapshot.track.as_ref().map(|t| t.uri.as_str())
    }

    #[test]
    fn no_sessions_publish_a_stopped_snapshot() {
        let mut reg = SessionRegistry::new();
        let snap = reg.observe(1_000, vec![]);
        assert_eq!(snap.state, PlaybackState::Stopped);
        assert!(snap.track.is_none());
        assert!(reg.active().is_none());
    }

    #[test]
    fn first_playing_session_is_followed_immediately() {
        let mut reg = SessionRegistry::new();
        let snap = reg.observe(1_000, vec![paused("b", "b:1"), playing("a", "a:1")]);
        assert_eq!(uri(&snap), Some("a:1"));
        assert_eq!(reg.active().unwrap().id, "a");
    }

    #[test]
    fn new_player_takes_over_only_after_hysteresis() {
        let mut reg = SessionRegistry::new();
        reg.observe(0, vec![playing("a", "a:1")]);
        let snap = reg.observe(1_000, vec![playing("a", "a:1"), playing("b", "b:1")]);
        assert_eq!(uri(&snap), Some("a:1"), "b started 0 ms ago");
        let snap = reg.observe(
            1_000 + SWITCH_HYSTERESIS_MS - 1,
            vec![playing("a", "a:1"), playing("b", "b:1")],
        );
        assert_eq!(uri(&snap), Some("a:1"));
        let snap = reg.observe(
            1_000 + SWITCH_HYSTERESIS_MS,
            vec![playing("a", "a:1"), playing("b", "b:1")],
        );
        assert_eq!(uri(&snap), Some("b:1"));
    }

    #[test]
    fn short_blip_never_steals_focus() {
        let mut reg = SessionRegistry::new();
        reg.observe(0, vec![playing("a", "a:1")]);
        reg.observe(500, vec![playing("a", "a:1"), playing("b", "b:1")]);
        let snap = reg.observe(900, vec![playing("a", "a:1"), paused("b", "b:1")]);
        assert_eq!(uri(&snap), Some("a:1"));
        let snap = reg.observe(5_000, vec![playing("a", "a:1"), paused("b", "b:1")]);
        assert_eq!(uri(&snap), Some("a:1"));
    }

    #[test]
    fn paused_current_session_is_sticky_until_another_plays() {
        let mut reg = SessionRegistry::new();
        reg.observe(0, vec![playing("a", "a:1"), paused("b", "b:1")]);
        let snap = reg.observe(1_000, vec![paused("a", "a:1"), paused("b", "b:1")]);
        assert_eq!(uri(&snap), Some("a:1"));
        // Current is paused, so a newly playing session wins without waiting.
        let snap = reg.observe(2_000, vec![paused("a", "a:1"), playing("b", "b:1")]);
        assert_eq!(uri(&snap), Some("b:1"));
    }

    #[test]
    fn auto_advance_does_not_reset_playing_since() {
        let mut reg = SessionRegistry::new();
        reg.observe(0, vec![playing("a", "a:1")]);
        reg.observe(100, vec![playing("a", "a:1"), playing("b", "b:1")]);
        // a moves to its next track; it must not look newly started.
        let snap = reg.observe(
            100 + SWITCH_HYSTERESIS_MS,
            vec![playing("a", "a:2"), playing("b", "b:1")],
        );
        assert_eq!(uri(&snap), Some("b:1"));
    }

    #[test]
    fn os_current_hint_breaks_ties_when_nothing_plays() {
        let mut reg = SessionRegistry::new();
        let mut b = paused("b", "b:1");
        b.os_current = true;
        let snap = reg.observe(0, vec![paused("a", "a:1"), b]);
        assert_eq!(uri(&snap), Some("b:1"));
    }

    #[test]
    fn metadata_only_track_waits_for_stable_metadata() {
        let mut reg = SessionRegistry::new();
        let first = candidate("a", PlaybackState::Playing, Some(track("meta::x", false)));
        let snap = reg.observe(0, vec![first.clone()]);
        assert!(snap.track.is_none(), "unsettled track is not published");
        assert!(reg.is_settling());

        let snap = reg.observe(300, vec![first]);
        assert_eq!(uri(&snap), Some("meta::x"));
        assert!(!reg.is_settling());
    }

    #[test]
    fn changing_metadata_restarts_settling_and_keeps_previous_track() {
        let mut reg = SessionRegistry::new();
        let settled = candidate("a", PlaybackState::Playing, Some(track("meta::old", false)));
        reg.observe(0, vec![settled.clone()]);
        reg.observe(300, vec![settled]);

        let mut half = track("meta::new", false);
        half.artist = "previous artist".into();
        let snap = reg.observe(
            600,
            vec![candidate("a", PlaybackState::Playing, Some(half))],
        );
        assert_eq!(uri(&snap), Some("meta::old"));

        let full = candidate("a", PlaybackState::Playing, Some(track("meta::new", false)));
        let snap = reg.observe(900, vec![full.clone()]);
        assert_eq!(uri(&snap), Some("meta::old"), "signature changed");
        let snap = reg.observe(1_200, vec![full]);
        assert_eq!(uri(&snap), Some("meta::new"));
    }

    #[test]
    fn native_id_tracks_publish_without_settling() {
        let mut reg = SessionRegistry::new();
        let snap = reg.observe(0, vec![playing("a", "spotify:track:1")]);
        assert_eq!(uri(&snap), Some("spotify:track:1"));
        assert!(!reg.is_settling());
    }

    #[test]
    fn state_change_on_settled_track_publishes_immediately() {
        let mut reg = SessionRegistry::new();
        let track = track("meta::x", false);
        let p = candidate("a", PlaybackState::Playing, Some(track.clone()));
        reg.observe(0, vec![p.clone()]);
        reg.observe(300, vec![p]);
        let snap = reg.observe(
            600,
            vec![candidate("a", PlaybackState::Paused, Some(track))],
        );
        assert_eq!(snap.state, PlaybackState::Paused);
    }

    #[test]
    fn active_session_exposes_routing_and_caps() {
        let mut reg = SessionRegistry::new();
        let mut c = playing("a", "a:1");
        c.adapter = 2;
        c.snapshot.caps = PlaybackCaps {
            seek: false,
            ..PlaybackCaps::ALL
        };
        reg.observe(0, vec![c]);
        let active = reg.active().unwrap();
        assert_eq!(active.adapter, 2);
        assert!(!active.caps.seek);
        let info = reg.sessions();
        assert_eq!(info.len(), 1);
        assert!(info[0].active);
    }

    #[test]
    fn ignored_sessions_are_never_followed_but_are_reported_when_idle() {
        let mut reg = SessionRegistry::new();
        let mut video = playing("chrome", "meta::video");
        video.ignored = Some(IgnoreReason::NotMusicSignals);
        let snap = reg.observe(0, vec![video.clone()]);
        assert!(snap.track.is_none());
        let ignored = snap.ignored.expect("idle snapshot names the ignored media");
        assert_eq!(ignored.track_key, "meta::video");
        assert_eq!(ignored.reason, IgnoreReason::NotMusicSignals);
        assert!(reg.active().is_none());

        // A followed session wins, and the idle report goes away.
        let snap = reg.observe(100, vec![video, paused("spotify", "spotify:track:1")]);
        assert_eq!(uri(&snap), Some("spotify:track:1"));
        assert!(snap.ignored.is_none());
        let info = reg.sessions();
        assert_eq!(info.iter().filter(|s| s.ignored.is_some()).count(), 1);
    }

    #[test]
    fn current_session_is_dropped_once_ignored() {
        let mut reg = SessionRegistry::new();
        reg.observe(0, vec![playing("a", "a:1")]);
        let mut now_ignored = playing("a", "a:1");
        now_ignored.ignored = Some(IgnoreReason::MarkedNotMusic);
        let snap = reg.observe(100, vec![now_ignored]);
        assert!(snap.track.is_none());
        assert_eq!(
            snap.ignored.map(|i| i.reason),
            Some(IgnoreReason::MarkedNotMusic)
        );
    }
}
