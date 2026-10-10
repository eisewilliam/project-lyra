//! Owns the platform adapters, the session registry and the media policy.
//!
//! The host calls `poll` from its playback driver and `control` from command
//! handlers. Neither holds the runtime lock: adapter calls block on OS IPC,
//! and the registry and policy locks are taken only around pure bookkeeping.
//! Each poll classifies every session (music or not), applies the user's
//! rules, and queues background lyric lookups for browser media it cannot
//! classify; the host runs those with `take_probes`.

use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use super::artwork::{ArtworkBlob, ArtworkStore};
use super::classify::{classify, image_size, MediaFacts};
use super::known::KnownPlayers;
use super::metadata::{clean_video_metadata, display_name, is_advertisement, is_browser};
use super::policy::{decide, LyricVerdict, MediaPolicy, MediaPolicyStore, Subject};
use super::registry::{Candidate, SessionRegistry};
use super::{now_ms, ControlError, PlayerAdapter, PlayerCommand, SessionObservation};
use crate::domain::{
    FollowRule, KnownPlayerInfo, MediaKind, MediaPolicyView, PlaybackCaps, PlaybackSnapshot,
    PlayerApp, PlayerSessionInfo, TrackRef, Transport,
};
use crate::lyrics::cache::LyricCache;

/// A track whose background lookup failed (e.g. offline) is retried after
/// this long.
const PROBE_RETRY_MS: u64 = 60_000;

#[derive(Default)]
struct Probes {
    pending: Vec<TrackRef>,
    requested_at: HashMap<String, u64>,
}

pub struct PlayerHub {
    adapters: Vec<Box<dyn PlayerAdapter>>,
    registry: Mutex<SessionRegistry>,
    artwork: ArtworkStore,
    policy: Mutex<MediaPolicy>,
    policy_store: Option<MediaPolicyStore>,
    /// Cached lookup results settle whether unsure media is music.
    lyrics: Option<LyricCache>,
    /// Browser media may be looked up (the user's lyric-lookup consent).
    lookups_allowed: AtomicBool,
    probes: Mutex<Probes>,
    known: Mutex<KnownPlayers>,
}

impl PlayerHub {
    /// `artwork_base_url` is the host's URL prefix for `artwork`, ending in `/`.
    pub fn new(adapters: Vec<Box<dyn PlayerAdapter>>, artwork_base_url: impl Into<String>) -> Self {
        Self {
            adapters,
            registry: Mutex::new(SessionRegistry::new()),
            artwork: ArtworkStore::new(artwork_base_url),
            policy: Mutex::new(MediaPolicy::default()),
            policy_store: None,
            lyrics: None,
            lookups_allowed: AtomicBool::new(false),
            probes: Mutex::new(Probes::default()),
            known: Mutex::new(KnownPlayers::default()),
        }
    }

    /// Remember players seen across runs in the host-selected directory.
    pub fn with_known_players(mut self, app_support_dir: &Path) -> Self {
        *self.known.get_mut().unwrap_or_else(|e| e.into_inner()) =
            KnownPlayers::load(app_support_dir);
        self
    }

    /// Load and persist the media policy in the host-selected directory.
    pub fn with_media_policy(mut self, app_support_dir: &Path) -> Self {
        let store = MediaPolicyStore::new(app_support_dir);
        *self.policy.get_mut().unwrap_or_else(|e| e.into_inner()) = store.load();
        self.policy_store = Some(store);
        self
    }

    /// Read lyric results from the runtime's cache when classifying.
    pub fn with_lyric_cache(mut self, cache: LyricCache) -> Self {
        self.lyrics = Some(cache);
        self
    }

    /// Whether browser media may be looked up; mirrors the user's consent.
    pub fn set_lookups_allowed(&self, allowed: bool) {
        self.lookups_allowed.store(allowed, Ordering::Relaxed);
    }

    /// Observe every adapter and return the snapshot Lyra should display.
    pub fn poll(&self) -> PlaybackSnapshot {
        let observed: Vec<(usize, Transport, SessionObservation)> = self
            .adapters
            .iter()
            .enumerate()
            .flat_map(|(index, adapter)| {
                let transport = adapter.transport();
                adapter
                    .sessions()
                    .into_iter()
                    .map(move |observation| (index, transport, observation))
            })
            .collect();

        let lookups_allowed = self.lookups_allowed.load(Ordering::Relaxed);
        let mut probes = Vec::new();
        let mut round = Vec::with_capacity(observed.len());
        {
            let policy = self.lock_policy();
            for (adapter, transport, observation) in observed {
                let mut snapshot = observation.snapshot;
                let mut ignored = None;
                if let Some(track) = snapshot.track.as_mut() {
                    track.from_browser = is_browser(&track.player.id);
                    let class = classify(&MediaFacts {
                        app_id: &track.player.id,
                        from_browser: track.from_browser,
                        title: &track.title,
                        artist: &track.artist,
                        album: track.album.as_deref(),
                        duration_ms: track.duration_ms,
                        track_key: &track.uri,
                        page_url: track.page_url.as_deref(),
                        artwork_size: observation
                            .artwork
                            .as_ref()
                            .and_then(|a| image_size(&a.data)),
                    });
                    if track.from_browser {
                        let (title, artist) = clean_video_metadata(&track.title, &track.artist);
                        track.title = title;
                        track.artist = artist;
                    }
                    if is_advertisement(&track.title, &track.artist) {
                        continue;
                    }
                    let verdict = if class.kind == MediaKind::Unsure {
                        self.verdict(&track.uri)
                    } else {
                        LyricVerdict::Unknown
                    };
                    let decision = decide(
                        &policy,
                        Subject {
                            app_id: &track.player.id,
                            track_key: &track.uri,
                            from_browser: track.from_browser,
                        },
                        class,
                        verdict,
                        lookups_allowed,
                    );
                    track.kind = decision.kind;
                    track.platform = class.platform.map(|p| p.name().to_string());
                    ignored = decision.ignored;
                    if decision.probe {
                        probes.push(track.clone());
                    }
                    if let (Some(artwork), None) = (&observation.artwork, &track.artwork_url) {
                        track.artwork_url = Some(self.artwork.publish(artwork));
                    }
                }
                round.push(Candidate {
                    adapter,
                    transport,
                    id: observation.id,
                    snapshot,
                    os_current: observation.os_current,
                    ignored,
                });
            }
        }
        keep_best_transport_per_app(&mut round);
        let now = now_ms();
        self.lock_known().record(
            round
                .iter()
                .filter_map(|c| c.snapshot.track.as_ref().map(|t| (&t.player, c.transport))),
            now,
        );
        self.queue_probes(probes, now);
        self.lock_registry().observe(now, round)
    }

    /// Tracks to look up in the background, each requested at most once per
    /// `PROBE_RETRY_MS`. The host runs the lookups; results land in the lyric
    /// cache and settle the next poll's decision.
    pub fn take_probes(&self) -> Vec<TrackRef> {
        std::mem::take(&mut self.lock_probes().pending)
    }

    /// Stop adapter helper processes; call once before the app exits.
    pub fn shutdown(&self) {
        for adapter in &self.adapters {
            adapter.shutdown();
        }
    }

    /// Route a command to the followed session. Unsupported controls fail
    /// before reaching the player.
    pub fn control(&self, command: PlayerCommand) -> Result<(), ControlError> {
        let active = self
            .lock_registry()
            .active()
            .ok_or(ControlError::NoSession)?;
        if !allows(active.caps, command) {
            return Err(ControlError::Unsupported);
        }
        self.adapters
            .get(active.adapter)
            .ok_or(ControlError::NoSession)?
            .control(&active.id, command)
    }

    /// See `SessionRegistry::is_settling`.
    pub fn is_settling(&self) -> bool {
        self.lock_registry().is_settling()
    }

    /// Diagnostics for every observed session, including the user's rule
    /// and override for it.
    pub fn sessions(&self) -> Vec<PlayerSessionInfo> {
        let mut sessions = self.lock_registry().sessions();
        let policy = self.lock_policy();
        for session in &mut sessions {
            if let Some(player) = &session.player {
                session.app_rule = policy.app_rule(&player.id);
            }
            if let Some(key) = &session.track_key {
                session.marked_music = policy.track_override(key);
            }
        }
        sessions
    }

    /// Every player Lyra has seen, most recently seen first, with the
    /// user's rule for it and whether it is running now.
    pub fn known_players(&self) -> Vec<KnownPlayerInfo> {
        let running: Vec<String> = self
            .lock_registry()
            .sessions()
            .into_iter()
            .filter_map(|s| s.player.map(|p| p.id))
            .collect();
        let policy = self.lock_policy();
        let mut players: Vec<KnownPlayerInfo> = self
            .lock_known()
            .list()
            .iter()
            .map(|known| KnownPlayerInfo {
                app: known.app.clone(),
                transport: known.transport,
                last_seen_ms: known.last_seen_ms,
                running: running.contains(&known.app.id),
                rule: policy.app_rule(&known.app.id),
                pinned: policy
                    .pinned_app
                    .as_ref()
                    .is_some_and(|pinned| pinned.id == known.app.id),
            })
            .collect();
        players.sort_by_key(|p| std::cmp::Reverse(p.last_seen_ms));
        players
    }

    /// Forget a player and its settings; it reappears if it plays again.
    pub fn forget_player(&self, app_id: &str) -> anyhow::Result<MediaPolicyView> {
        self.lock_known().forget(app_id, now_ms());
        self.update_policy(|policy| {
            policy.set_app_rule(app_id, FollowRule::Auto);
            if policy.pinned_app.as_ref().is_some_and(|p| p.id == app_id) {
                policy.pinned_app = None;
            }
        })
    }

    pub fn media_policy(&self) -> MediaPolicyView {
        self.lock_policy().view()
    }

    /// Follow or ignore all media regardless of what it is (`false`).
    pub fn set_only_music(&self, only_music: bool) -> anyhow::Result<MediaPolicyView> {
        self.update_policy(|policy| policy.only_music = only_music)
    }

    /// Follow only `app_id`, or select players automatically (`None`). The
    /// app's display name is kept so settings can name it while it is not
    /// running.
    pub fn set_pinned_app(&self, app_id: Option<&str>) -> anyhow::Result<MediaPolicyView> {
        let pinned = app_id.map(|id| {
            self.lock_registry()
                .sessions()
                .into_iter()
                .filter_map(|s| s.player)
                .find(|player| player.id == id)
                .unwrap_or_else(|| PlayerApp {
                    id: id.to_string(),
                    name: display_name(id),
                })
        });
        self.update_policy(|policy| policy.pinned_app = pinned)
    }

    pub fn set_app_rule(&self, app_id: &str, rule: FollowRule) -> anyhow::Result<MediaPolicyView> {
        self.update_policy(|policy| policy.set_app_rule(app_id, rule))
    }

    /// Mark one track as music (`Some(true)`), not music, or clear the mark.
    pub fn set_track_override(
        &self,
        track_key: &str,
        is_music: Option<bool>,
    ) -> anyhow::Result<MediaPolicyView> {
        self.update_policy(|policy| policy.set_track_override(track_key, is_music))
    }

    pub fn artwork(&self, id: &str) -> Option<ArtworkBlob> {
        self.artwork.get(id)
    }

    fn update_policy(
        &self,
        change: impl FnOnce(&mut MediaPolicy),
    ) -> anyhow::Result<MediaPolicyView> {
        let mut policy = self.lock_policy();
        change(&mut policy);
        if let Some(store) = &self.policy_store {
            store.save(&policy)?;
        }
        Ok(policy.view())
    }

    fn verdict(&self, track_key: &str) -> LyricVerdict {
        match &self.lyrics {
            Some(cache) if cache.has_lyrics(track_key) => LyricVerdict::Found,
            Some(cache) if cache.is_negative(track_key) => LyricVerdict::Missing,
            _ => LyricVerdict::Unknown,
        }
    }

    fn queue_probes(&self, tracks: Vec<TrackRef>, now: u64) {
        let mut probes = self.lock_probes();
        probes
            .requested_at
            .retain(|_, at| now.saturating_sub(*at) < PROBE_RETRY_MS);
        for track in tracks {
            if !probes.requested_at.contains_key(&track.uri) {
                probes.requested_at.insert(track.uri.clone(), now);
                probes.pending.push(track);
            }
        }
    }

    fn lock_registry(&self) -> std::sync::MutexGuard<'_, SessionRegistry> {
        self.registry.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn lock_policy(&self) -> std::sync::MutexGuard<'_, MediaPolicy> {
        self.policy.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn lock_known(&self) -> std::sync::MutexGuard<'_, KnownPlayers> {
        self.known.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn lock_probes(&self) -> std::sync::MutexGuard<'_, Probes> {
        self.probes.lock().unwrap_or_else(|e| e.into_inner())
    }
}

/// Preference when two transports report the same app: app-specific
/// scripting carries native IDs and file paths; MediaRemote is the fallback.
fn transport_rank(transport: Transport) -> u8 {
    match transport {
        Transport::AppleScript => 0,
        Transport::Smtc | Transport::Mpris => 1,
        Transport::MediaRemote => 2,
    }
}

/// Drop duplicate sessions for one app seen through several transports
/// (e.g. Spotify via AppleScript and MediaRemote on macOS).
fn keep_best_transport_per_app(round: &mut Vec<Candidate>) {
    let app = |c: &Candidate| c.snapshot.track.as_ref().map(|t| t.player.id.clone());
    let snapshot: Vec<(Option<String>, u8)> = round
        .iter()
        .map(|c| (app(c), transport_rank(c.transport)))
        .collect();
    let mut index = 0;
    round.retain(|_| {
        let (id, rank) = &snapshot[index];
        index += 1;
        let Some(id) = id else { return true };
        !snapshot
            .iter()
            .any(|(other, other_rank)| other.as_ref() == Some(id) && other_rank < rank)
    });
}

fn allows(caps: PlaybackCaps, command: PlayerCommand) -> bool {
    match command {
        PlayerCommand::PlayPause => caps.play_pause,
        PlayerCommand::Next => caps.next,
        PlayerCommand::Previous => caps.previous,
        PlayerCommand::SeekMs(_) => caps.seek,
        PlayerCommand::Raise => caps.raise,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{IgnoreReason, PlaybackState, PositionQuality, TrackRef, Transport};
    use crate::player::{ArtworkBytes, SessionObservation};
    use std::sync::Arc;

    type CommandLog = Arc<Mutex<Vec<(String, PlayerCommand)>>>;

    struct FakeAdapter {
        session: Option<SessionObservation>,
        commands: CommandLog,
        transport: Transport,
    }

    impl PlayerAdapter for FakeAdapter {
        fn transport(&self) -> Transport {
            self.transport
        }
        fn sessions(&self) -> Vec<SessionObservation> {
            self.session.clone().into_iter().collect()
        }
        fn control(&self, id: &str, command: PlayerCommand) -> Result<(), ControlError> {
            self.commands
                .lock()
                .unwrap()
                .push((id.to_string(), command));
            Ok(())
        }
    }

    fn observation(id: &str, caps: PlaybackCaps) -> SessionObservation {
        SessionObservation {
            id: id.into(),
            snapshot: PlaybackSnapshot {
                track: Some(TrackRef::fixture(&format!("native:{id}"))),
                state: PlaybackState::Playing,
                position_ms: Some(0),
                observed_at_ms: now_ms(),
                rate: 1.0,
                ignored: None,
                position_quality: PositionQuality::Exact,
                caps,
            },
            artwork: Some(ArtworkBytes {
                key: format!("native:{id}"),
                mime: "image/jpeg",
                data: Arc::from(&b"jpeg"[..]),
            }),
            os_current: false,
        }
    }

    fn fake(session: Option<SessionObservation>) -> Box<FakeAdapter> {
        fake_logged(session, CommandLog::default())
    }

    fn fake_logged(session: Option<SessionObservation>, commands: CommandLog) -> Box<FakeAdapter> {
        Box::new(FakeAdapter {
            session,
            commands,
            transport: Transport::Smtc,
        })
    }

    fn fake_on(transport: Transport, session: SessionObservation) -> Box<FakeAdapter> {
        Box::new(FakeAdapter {
            session: Some(session),
            commands: CommandLog::default(),
            transport,
        })
    }

    fn with_player(
        mut obs: SessionObservation,
        app_id: &str,
        title: &str,
        artist: &str,
    ) -> SessionObservation {
        let track = obs.snapshot.track.as_mut().unwrap();
        track.player.id = app_id.into();
        track.player.name = display_name(app_id);
        track.title = title.into();
        track.artist = artist.into();
        obs
    }

    #[test]
    fn same_app_on_two_transports_keeps_the_richer_one() {
        let applescript = with_player(
            observation("applescript:spotify", PlaybackCaps::ALL),
            "com.spotify.client",
            "Song",
            "Artist",
        );
        let mediaremote = with_player(
            observation("mediaremote:spotify", PlaybackCaps::ALL),
            "com.spotify.client",
            "Song",
            "Artist",
        );
        let hub = PlayerHub::new(
            vec![
                fake_on(Transport::MediaRemote, mediaremote),
                fake_on(Transport::AppleScript, applescript),
            ],
            "x/",
        );
        hub.poll();
        let sessions = hub.sessions();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].id, "applescript:spotify");
    }

    #[test]
    fn browser_tracks_are_flagged_and_cleaned_and_ads_dropped() {
        let video = with_player(
            observation("mediaremote:chrome", PlaybackCaps::ALL),
            "com.google.Chrome",
            "The Weeknd - Blinding Lights (Official Video)",
            "TheWeekndVEVO",
        );
        let hub = PlayerHub::new(vec![fake_on(Transport::MediaRemote, video)], "x/");
        let track = hub.poll().track.unwrap();
        assert!(track.from_browser);
        assert_eq!(track.title, "Blinding Lights");
        assert_eq!(track.artist, "The Weeknd");

        let ad = with_player(
            observation("smtc:spotify", PlaybackCaps::ALL),
            "Spotify.exe",
            "Advertisement",
            "",
        );
        let hub = PlayerHub::new(vec![fake_on(Transport::Smtc, ad)], "x/");
        assert!(hub.poll().track.is_none());
        assert!(hub.sessions().is_empty());
    }

    #[test]
    fn commands_route_to_the_adapter_owning_the_active_session() {
        let idle = CommandLog::default();
        let owner = CommandLog::default();
        let hub = PlayerHub::new(
            vec![
                fake_logged(None, idle.clone()),
                fake_logged(Some(observation("b", PlaybackCaps::ALL)), owner.clone()),
            ],
            "lyra-art://localhost/",
        );
        hub.poll();
        assert_eq!(hub.control(PlayerCommand::Next), Ok(()));
        assert!(idle.lock().unwrap().is_empty());
        assert_eq!(
            owner.lock().unwrap().as_slice(),
            &[("b".to_string(), PlayerCommand::Next)]
        );
    }

    #[test]
    fn unsupported_and_missing_sessions_fail_before_the_adapter() {
        let caps = PlaybackCaps {
            seek: false,
            ..PlaybackCaps::ALL
        };
        let hub = PlayerHub::new(vec![fake(Some(observation("a", caps)))], "x/");
        assert_eq!(
            hub.control(PlayerCommand::PlayPause),
            Err(ControlError::NoSession)
        );
        hub.poll();
        assert_eq!(
            hub.control(PlayerCommand::SeekMs(5)),
            Err(ControlError::Unsupported)
        );
        assert_eq!(hub.control(PlayerCommand::PlayPause), Ok(()));
    }

    #[test]
    fn artwork_bytes_become_a_servable_url() {
        let hub = PlayerHub::new(
            vec![fake(Some(observation("a", PlaybackCaps::ALL)))],
            "lyra-art://localhost/",
        );
        let snapshot = hub.poll();
        let url = snapshot.track.unwrap().artwork_url.unwrap();
        let id = url.strip_prefix("lyra-art://localhost/").unwrap();
        assert_eq!(&*hub.artwork(id).unwrap().data, b"jpeg");
    }

    fn unsure_browser_song() -> SessionObservation {
        let mut obs = with_player(
            observation("mediaremote:chrome", PlaybackCaps::ALL),
            "com.google.Chrome",
            "Divinize",
            "ROSALÍA",
        );
        let track = obs.snapshot.track.as_mut().unwrap();
        track.uri = "meta::rosal%C3%ADa::divinize::247".into();
        track.native_id = None;
        track.duration_ms = 247_000;
        obs.artwork = None;
        obs
    }

    fn temp_cache(name: &str) -> (LyricCache, std::path::PathBuf) {
        let dir = std::env::temp_dir().join(format!("lyra-hub-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let cache = LyricCache::new(&dir);
        cache.ensure_dirs().unwrap();
        (cache, dir)
    }

    #[test]
    fn unsure_browser_media_is_ignored_until_lookups_settle_it() {
        let (cache, dir) = temp_cache("probe");
        let hub = PlayerHub::new(
            vec![fake_on(Transport::MediaRemote, unsure_browser_song())],
            "x/",
        )
        .with_lyric_cache(cache.clone());

        // Lookups not allowed: ignored, nothing queued.
        let snap = hub.poll();
        assert!(snap.track.is_none());
        assert_eq!(
            snap.ignored.map(|i| i.reason),
            Some(IgnoreReason::Unconfirmed)
        );
        assert!(hub.take_probes().is_empty());

        // Allowed: checked in the background, once.
        hub.set_lookups_allowed(true);
        assert_eq!(
            hub.poll().ignored.map(|i| i.reason),
            Some(IgnoreReason::Checking)
        );
        let probes = hub.take_probes();
        assert_eq!(probes.len(), 1);
        assert_eq!(probes[0].title, "Divinize");
        hub.poll();
        assert!(
            hub.take_probes().is_empty(),
            "not re-queued within the retry window"
        );

        // Lyrics found: it is music and followed (after metadata settles).
        cache.put(&probes[0].uri, "[00:01.00]line").unwrap();
        hub.poll();
        let snap = hub.poll();
        let track = snap.track.expect("followed once lyrics are found");
        assert_eq!(track.kind, MediaKind::Music);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn missing_lyrics_mark_unsure_media_as_not_music() {
        let (cache, dir) = temp_cache("miss");
        let song = unsure_browser_song();
        cache
            .mark_negative(&song.snapshot.track.as_ref().unwrap().uri)
            .unwrap();
        let hub = PlayerHub::new(vec![fake_on(Transport::MediaRemote, song)], "x/")
            .with_lyric_cache(cache);
        hub.set_lookups_allowed(true);
        let snap = hub.poll();
        assert_eq!(
            snap.ignored.map(|i| i.reason),
            Some(IgnoreReason::NoLyricsFound)
        );
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn user_overrides_follow_or_ignore_and_persist() {
        let dir = std::env::temp_dir().join(format!("lyra-hub-policy-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let song = unsure_browser_song();
        let key = song.snapshot.track.as_ref().unwrap().uri.clone();
        let hub = PlayerHub::new(vec![fake_on(Transport::MediaRemote, song.clone())], "x/")
            .with_media_policy(&dir);

        hub.set_track_override(&key, Some(true)).unwrap();
        hub.poll();
        assert!(hub.poll().track.is_some(), "marked as music is followed");
        let session = &hub.sessions()[0];
        assert_eq!(session.marked_music, Some(true));

        hub.set_track_override(&key, None).unwrap();
        hub.set_app_rule("com.google.Chrome", FollowRule::Always)
            .unwrap();
        assert!(hub.poll().track.is_some());
        assert_eq!(hub.sessions()[0].app_rule, FollowRule::Always);

        hub.set_app_rule("com.google.Chrome", FollowRule::Never)
            .unwrap();
        assert_eq!(
            hub.poll().ignored.map(|i| i.reason),
            Some(IgnoreReason::AppRule)
        );

        // Reloaded from disk.
        let reloaded = PlayerHub::new(vec![fake_on(Transport::MediaRemote, song)], "x/")
            .with_media_policy(&dir);
        assert_eq!(
            reloaded.media_policy().app_rules.get("com.google.Chrome"),
            Some(&FollowRule::Never)
        );
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn pinning_a_player_turns_off_automatic_selection() {
        let dir = std::env::temp_dir().join(format!("lyra-hub-pin-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let spotify = observation("applescript:spotify", PlaybackCaps::ALL);
        let mut paused_video = with_player(
            observation("mediaremote:chrome", PlaybackCaps::ALL),
            "com.google.Chrome",
            "I Survived 100 Days in the Wilderness",
            "MrBeast",
        );
        paused_video.snapshot.track.as_mut().unwrap().duration_ms = 1_500_000;
        let hub = PlayerHub::new(
            vec![
                fake_on(Transport::AppleScript, spotify),
                fake_on(Transport::MediaRemote, paused_video),
            ],
            "x/",
        )
        .with_media_policy(&dir);
        // Automatic: the video is not music, Spotify is followed.
        let track = hub.poll().track.unwrap();
        assert_eq!(track.player.id, "com.spotify.client");

        // Pinned to Chrome: its media is followed whatever it is.
        let view = hub.set_pinned_app(Some("com.google.Chrome")).unwrap();
        assert_eq!(
            view.pinned_app.as_ref().map(|p| p.name.as_str()),
            Some("Google Chrome")
        );
        hub.poll();
        let snap = hub.poll();
        assert_eq!(snap.track.unwrap().player.id, "com.google.Chrome");
        let spotify_session = hub
            .sessions()
            .into_iter()
            .find(|s| s.id == "applescript:spotify")
            .unwrap();
        assert_eq!(
            spotify_session.ignored,
            Some(IgnoreReason::OtherPlayerSelected)
        );

        hub.set_pinned_app(None).unwrap();
        assert_eq!(hub.poll().track.unwrap().player.id, "com.spotify.client");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn players_are_remembered_with_settings_and_can_be_forgotten() {
        let dir = std::env::temp_dir().join(format!("lyra-hub-known-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let hub = PlayerHub::new(
            vec![fake_on(
                Transport::AppleScript,
                observation("applescript:spotify", PlaybackCaps::ALL),
            )],
            "x/",
        )
        .with_media_policy(&dir)
        .with_known_players(&dir);
        hub.poll();
        hub.set_app_rule("com.spotify.client", FollowRule::Always)
            .unwrap();

        // A fresh hub with no running players still lists Spotify.
        let later = PlayerHub::new(vec![fake(None)], "x/")
            .with_media_policy(&dir)
            .with_known_players(&dir);
        later.poll();
        let known = later.known_players();
        assert_eq!(known.len(), 1);
        assert_eq!(known[0].app.id, "com.spotify.client");
        assert!(!known[0].running);
        assert_eq!(known[0].rule, FollowRule::Always);

        later.forget_player("com.spotify.client").unwrap();
        assert!(later.known_players().is_empty());
        assert!(later.media_policy().app_rules.is_empty());
        let _ = std::fs::remove_dir_all(dir);
    }
}
