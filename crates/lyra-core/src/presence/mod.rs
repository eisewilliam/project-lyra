//! Discord Rich Presence: shows the followed track on the user's Discord
//! profile through the desktop client's local RPC connection.
//!
//! `DiscordPresence` is the handle the host keeps. All socket work runs on
//! one worker thread, so `publish` never blocks the poll driver: it compares
//! the snapshot with what was last published and queues a change. The worker
//! connects while the feature is on, retries while Discord is closed, and
//! keeps updates inside Discord's rate limit.
//!
//! Players that share artwork only as image data get their cover from a
//! catalogue lookup (`cover`), which runs on a thread of its own.

mod activity;
mod cover;
mod ipc;

use std::collections::VecDeque;
use std::io;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

pub use activity::{Activity, ActivityButton, ActivityOptions};

use crate::domain::{DiscordPresenceStatus, PlaybackSnapshot, TrackRef};
use cover::CoverArt;
use ipc::Connection;

/// How often to look for Discord while it is not running.
const RECONNECT_INTERVAL: Duration = Duration::from_secs(15);
/// How often an idle connection is checked, to notice Discord quitting.
const IDLE_CHECK_INTERVAL: Duration = Duration::from_secs(5);
/// Discord accepts 5 presence updates per 20 seconds; stay one under.
const RATE_LIMIT_UPDATES: usize = 4;
const RATE_LIMIT_WINDOW: Duration = Duration::from_secs(20);

type Connector = Box<dyn FnMut() -> io::Result<Connection> + Send>;
type ConnectionListener = Box<dyn Fn(bool) + Send + Sync>;

pub struct DiscordPresence {
    shared: Arc<Shared>,
    /// `None` when the build has no Discord application to publish as.
    worker: Option<mpsc::Sender<Message>>,
    options: Mutex<ActivityOptions>,
    published: Mutex<Published>,
    covers: CoverArt,
}

#[derive(Default)]
struct Shared {
    enabled: AtomicBool,
    connected: AtomicBool,
    /// The user allows lookups for media playing in a browser.
    browser_lookups: AtomicBool,
    /// Counts connections, so `publish` resends after a reconnect.
    generation: AtomicU64,
    /// Discord's reason for refusing the last activity, for diagnostics.
    rejection: Mutex<Option<String>>,
    on_connection_change: Mutex<Option<ConnectionListener>>,
}

/// What `publish` last handed to the worker, and on which connection.
#[derive(Default)]
struct Published {
    generation: u64,
    activity: Option<Activity>,
}

enum Message {
    Show(Option<Activity>),
    /// Settings changed; re-read the shared flags.
    Wake,
}

impl DiscordPresence {
    /// `application_id` is the Discord application whose name and icon the
    /// activity carries. `button` adds a link to every activity.
    pub fn new(application_id: &str, button: Option<ActivityButton>) -> Self {
        let application_id = application_id.to_owned();
        Self::with_connector(
            Box::new(move || Connection::open(&application_id)),
            button,
            CoverArt::new(),
        )
    }

    /// A presence that never connects, for builds without an application ID.
    pub fn unavailable() -> Self {
        Self {
            shared: Arc::default(),
            worker: None,
            options: Mutex::default(),
            published: Mutex::default(),
            covers: CoverArt::disabled(),
        }
    }

    fn with_connector(
        connector: Connector,
        button: Option<ActivityButton>,
        covers: CoverArt,
    ) -> Self {
        let shared = Arc::new(Shared::default());
        let (sender, receiver) = mpsc::channel();
        let worker_shared = Arc::clone(&shared);
        let spawned = std::thread::Builder::new()
            .name("discord-presence".into())
            .spawn(move || Worker::new(worker_shared, connector).run(&receiver));
        Self {
            shared,
            worker: spawned.is_ok().then_some(sender),
            options: Mutex::new(ActivityOptions {
                include_spotify: false,
                button,
            }),
            published: Mutex::default(),
            covers,
        }
    }

    /// Apply the user's settings. Turning the feature off clears the
    /// activity and disconnects.
    pub fn configure(&self, enabled: bool, include_spotify: bool) {
        let Some(worker) = &self.worker else {
            return;
        };
        lock(&self.options).include_spotify = include_spotify;
        if self.shared.enabled.swap(enabled, Ordering::AcqRel) != enabled {
            let _ = worker.send(Message::Wake);
        }
    }

    /// Whether media playing in a browser may be looked up; mirrors the
    /// user's lyric-lookup consent. Until it is given, nothing about browser
    /// media is sent to the cover catalogue.
    pub fn set_browser_lookups(&self, allowed: bool) {
        self.shared
            .browser_lookups
            .store(allowed, Ordering::Release);
    }

    /// Called from the lookup thread when a cover has been found for a
    /// track that was published without one. Publishing the current
    /// snapshot again then shows it.
    pub fn on_cover_found(&self, listener: impl Fn() + Send + Sync + 'static) {
        self.covers.on_found(listener);
    }

    /// Called from the worker thread when the connection to Discord opens
    /// or closes.
    pub fn on_connection_change(&self, listener: impl Fn(bool) + Send + Sync + 'static) {
        *lock(&self.shared.on_connection_change) = Some(Box::new(listener));
    }

    /// True while Discord is connected and showing what Lyra publishes, so
    /// the host keeps polling players even with every window hidden.
    pub fn wants_playback(&self) -> bool {
        self.shared.enabled.load(Ordering::Acquire) && self.shared.connected.load(Ordering::Acquire)
    }

    pub fn status(&self) -> DiscordPresenceStatus {
        DiscordPresenceStatus {
            available: self.worker.is_some(),
            connected: self.wants_playback(),
        }
    }

    /// Why Discord refused the last activity, if it did.
    pub fn last_rejection(&self) -> Option<String> {
        lock(&self.shared.rejection).clone()
    }

    /// Show `snapshot` on Discord. Cheap when nothing changed; pass freshly
    /// polled snapshots only, since a stale one would publish an old track.
    pub fn publish(&self, snapshot: &PlaybackSnapshot) {
        let Some(worker) = &self.worker else {
            return;
        };
        if !self.wants_playback() {
            return;
        }
        let generation = self.shared.generation.load(Ordering::Acquire);
        let mut activity =
            Activity::for_snapshot(snapshot, crate::player::now_ms(), &lock(&self.options));
        if let (Some(activity), Some(track)) = (activity.as_mut(), snapshot.track.as_ref()) {
            if !activity.has_cover() && self.may_look_up(track) {
                if let Some(url) = self.covers.cover_for(track) {
                    activity.set_cover(url);
                }
            }
        }

        let mut published = lock(&self.published);
        let unchanged = published.generation == generation
            && match (&published.activity, &activity) {
                (Some(old), Some(new)) => old.same_display(new),
                (None, None) => true,
                _ => false,
            };
        if unchanged {
            return;
        }
        *published = Published {
            generation,
            activity: activity.clone(),
        };
        let _ = worker.send(Message::Show(activity));
    }

    /// Whether `track`'s artist and title may be sent to the cover
    /// catalogue: browser media needs the user's consent, as for lyrics.
    fn may_look_up(&self, track: &TrackRef) -> bool {
        !track.from_browser || self.shared.browser_lookups.load(Ordering::Acquire)
    }
}

struct Worker {
    shared: Arc<Shared>,
    connector: Connector,
    connection: Option<Connection>,
    /// What Discord should show, and what it was last told to show.
    desired: Option<Activity>,
    shown: Option<Activity>,
    recent_updates: VecDeque<Instant>,
}

impl Worker {
    fn new(shared: Arc<Shared>, connector: Connector) -> Self {
        Self {
            shared,
            connector,
            connection: None,
            desired: None,
            shown: None,
            recent_updates: VecDeque::new(),
        }
    }

    /// Runs until the `DiscordPresence` handle is dropped.
    fn run(mut self, messages: &mpsc::Receiver<Message>) {
        loop {
            let wait = self.step();
            let message = match wait {
                Some(wait) => match messages.recv_timeout(wait) {
                    Ok(message) => Some(message),
                    Err(RecvTimeoutError::Timeout) => None,
                    Err(RecvTimeoutError::Disconnected) => break,
                },
                None => match messages.recv() {
                    Ok(message) => Some(message),
                    Err(_) => break,
                },
            };
            if let Some(Message::Show(activity)) = message {
                self.desired = activity;
            }
        }
        self.disconnect(true);
    }

    /// Do whatever is due and return how long to wait for the next message;
    /// `None` waits indefinitely.
    fn step(&mut self) -> Option<Duration> {
        if !self.shared.enabled.load(Ordering::Acquire) {
            self.disconnect(true);
            return None;
        }
        if self.connection.is_none() {
            match (self.connector)() {
                Ok(connection) => self.connected(connection),
                Err(_) => return Some(RECONNECT_INTERVAL),
            }
        }

        let mut wait = IDLE_CHECK_INTERVAL;
        let mut alive = true;
        if self.desired != self.shown {
            match self.rate_limit_delay() {
                Some(delay) => wait = wait.min(delay),
                None => alive = self.show_desired(),
            }
        }
        if alive {
            alive = self
                .connection
                .as_mut()
                .is_some_and(|connection| connection.drain().is_ok());
        }
        if !alive {
            self.disconnect(false);
            // Look again shortly: Discord may only be restarting.
            return Some(Duration::from_secs(1));
        }
        Some(wait)
    }

    fn connected(&mut self, connection: Connection) {
        self.connection = Some(connection);
        // Whatever was queued describes playback from before the
        // connection; `publish` sends the current track for the new one.
        self.desired = None;
        self.shown = None;
        self.shared.generation.fetch_add(1, Ordering::AcqRel);
        self.set_connected(true);
    }

    fn show_desired(&mut self) -> bool {
        let Some(connection) = self.connection.as_mut() else {
            return false;
        };
        match connection.set_activity(self.desired.as_ref()) {
            Ok(rejection) => {
                self.recent_updates.push_back(Instant::now());
                // A refused activity is not retried: the same payload would
                // be refused again.
                self.shown = self.desired.clone();
                *lock(&self.shared.rejection) = rejection;
                true
            }
            Err(_) => false,
        }
    }

    /// How long until Discord accepts another update, if it would not now.
    fn rate_limit_delay(&mut self) -> Option<Duration> {
        let now = Instant::now();
        while self
            .recent_updates
            .front()
            .is_some_and(|sent| now.duration_since(*sent) >= RATE_LIMIT_WINDOW)
        {
            self.recent_updates.pop_front();
        }
        if self.recent_updates.len() < RATE_LIMIT_UPDATES {
            return None;
        }
        self.recent_updates
            .front()
            .map(|oldest| RATE_LIMIT_WINDOW.saturating_sub(now.duration_since(*oldest)))
    }

    /// `clear` removes the activity first; without it the connection is
    /// already gone and Discord clears the activity itself.
    fn disconnect(&mut self, clear: bool) {
        if let Some(connection) = self.connection.take() {
            if clear {
                connection.close();
            }
        }
        self.desired = None;
        self.shown = None;
        self.set_connected(false);
    }

    fn set_connected(&self, connected: bool) {
        if self.shared.connected.swap(connected, Ordering::AcqRel) != connected {
            if let Some(listener) = lock(&self.shared.on_connection_change).as_ref() {
                listener(connected);
            }
        }
    }
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|e| e.into_inner())
}

#[cfg(all(test, unix))]
mod tests {
    use super::cover::test_support::{catalogue, cover_url, found, result};
    use super::ipc::test_support::FakeDiscord;
    use super::*;
    use crate::domain::{PlaybackCaps, PlaybackState, PlayerApp, PositionQuality, TrackRef};
    use std::sync::atomic::AtomicUsize;

    fn playing(title: &str) -> PlaybackSnapshot {
        PlaybackSnapshot {
            track: Some(TrackRef {
                player: PlayerApp {
                    id: "com.apple.Music".into(),
                    name: "Music".into(),
                },
                title: title.into(),
                ..TrackRef::fixture("meta::artist::title::180")
            }),
            state: PlaybackState::Playing,
            position_ms: Some(1_000),
            observed_at_ms: crate::player::now_ms(),
            rate: 1.0,
            position_quality: PositionQuality::Exact,
            caps: PlaybackCaps::ALL,
            ignored: None,
        }
    }

    /// A presence whose connector hands out the given fake clients in turn,
    /// then fails as if Discord were closed. It looks no covers up.
    fn presence_with(clients: Vec<FakeDiscord>) -> (DiscordPresence, mpsc::Receiver<FakeDiscord>) {
        presence_with_covers(clients, CoverArt::disabled())
    }

    fn presence_with_covers(
        clients: Vec<FakeDiscord>,
        covers: CoverArt,
    ) -> (DiscordPresence, mpsc::Receiver<FakeDiscord>) {
        let (accepted, server_ends) = mpsc::channel();
        let mut clients = clients.into_iter();
        let connector: Connector = Box::new(move || {
            let _ = &clients;
            let (pipe, mut discord) = FakeDiscord::pair();
            if clients.next().is_none() {
                return Err(io::ErrorKind::NotFound.into());
            }
            let server = std::thread::spawn(move || {
                discord.accept();
                discord
            });
            let connection = Connection::handshake(pipe, "123");
            let _ = accepted.send(server.join().unwrap());
            connection
        });
        (
            DiscordPresence::with_connector(connector, None, covers),
            server_ends,
        )
    }

    /// Stand-ins for "one client available" per connection attempt.
    fn clients(count: usize) -> Vec<FakeDiscord> {
        (0..count).map(|_| FakeDiscord::pair().1).collect()
    }

    fn wait_until(what: &str, condition: impl Fn() -> bool) {
        let deadline = Instant::now() + Duration::from_secs(5);
        while !condition() {
            assert!(Instant::now() < deadline, "timed out waiting for {what}");
            std::thread::sleep(Duration::from_millis(5));
        }
    }

    #[test]
    fn stays_disconnected_until_enabled_and_publishes_once_per_change() {
        let (presence, discords) = presence_with(clients(1));
        assert!(!presence.wants_playback());
        presence.publish(&playing("Ignored"));

        presence.configure(true, false);
        let mut discord = discords.recv_timeout(Duration::from_secs(5)).unwrap();
        wait_until("connection", || presence.wants_playback());
        assert!(presence.status().connected);

        presence.publish(&playing("First"));
        presence.publish(&playing("First"));
        presence.publish(&playing("Second"));
        assert_eq!(discord.accept_activity()["details"], "First");
        assert_eq!(discord.accept_activity()["details"], "Second");

        let mut paused = playing("Second");
        paused.state = PlaybackState::Paused;
        presence.publish(&paused);
        assert!(discord.accept_activity().is_null());
    }

    #[test]
    fn turning_it_off_clears_the_activity_and_disconnects() {
        let (presence, discords) = presence_with(clients(1));
        let connections = Arc::new(Mutex::new(Vec::new()));
        let seen = Arc::clone(&connections);
        presence.on_connection_change(move |connected| lock(&seen).push(connected));

        presence.configure(true, false);
        let mut discord = discords.recv_timeout(Duration::from_secs(5)).unwrap();
        wait_until("connection", || presence.wants_playback());
        presence.publish(&playing("Song"));
        assert_eq!(discord.accept_activity()["details"], "Song");

        presence.configure(false, false);
        assert!(!presence.wants_playback());
        assert!(discord.accept_activity().is_null());
        assert_eq!(discord.read().0, 2, "close frame");
        wait_until("disconnect callback", || {
            *lock(&connections) == [true, false]
        });
    }

    #[test]
    fn republishes_the_current_track_after_discord_restarts() {
        let (presence, discords) = presence_with(clients(2));
        presence.configure(true, false);
        let mut first = discords.recv_timeout(Duration::from_secs(5)).unwrap();
        wait_until("connection", || presence.wants_playback());
        presence.publish(&playing("Song"));
        assert_eq!(first.accept_activity()["details"], "Song");

        drop(first);
        // The worker notices on its next write, then reconnects.
        presence.publish(&playing("Next"));
        let mut second = discords.recv_timeout(Duration::from_secs(10)).unwrap();
        wait_until("reconnection", || presence.wants_playback());
        presence.publish(&playing("Next"));
        assert_eq!(second.accept_activity()["details"], "Next");
    }

    #[test]
    fn a_found_cover_is_added_with_one_more_update() {
        let (covers, searches) =
            catalogue(vec![found(&[result("artist", "Song", "Album", "album")])]);
        let (presence, discords) = presence_with_covers(clients(1), covers);
        let found_cover = Arc::new(AtomicBool::new(false));
        let flag = Arc::clone(&found_cover);
        presence.on_cover_found(move || flag.store(true, Ordering::SeqCst));
        presence.configure(true, false);
        let mut discord = discords.recv_timeout(Duration::from_secs(5)).unwrap();
        wait_until("connection", || presence.wants_playback());

        // Shown at once without a cover, while the lookup runs.
        presence.publish(&playing("Song"));
        let first = discord.accept_activity();
        assert_eq!(first["details"], "Song");
        assert!(first.get("assets").is_none());

        wait_until("cover", || found_cover.load(Ordering::SeqCst));
        presence.publish(&playing("Song"));
        assert_eq!(
            discord.accept_activity()["assets"]["large_image"],
            cover_url("album")
        );

        // Nothing more is sent for the same track: the next update is the
        // next track, whose own artwork needs no lookup.
        presence.publish(&playing("Song"));
        let mut next = playing("Next");
        next.track.as_mut().unwrap().artwork_url = Some("https://example.com/next.jpg".into());
        presence.publish(&next);
        assert_eq!(discord.accept_activity()["details"], "Next");
        assert_eq!(searches.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn covers_are_looked_up_only_for_tracks_that_may_and_need_to_be() {
        let (covers, searches) = catalogue(vec![found(&[])]);
        let (presence, discords) = presence_with_covers(clients(1), covers);
        presence.configure(true, false);
        let mut discord = discords.recv_timeout(Duration::from_secs(5)).unwrap();
        wait_until("connection", || presence.wants_playback());
        let searched = |searches: &AtomicUsize| searches.load(Ordering::SeqCst);

        // Browser media before the user has allowed lookups for it.
        let mut browser = playing("In a browser");
        browser.track.as_mut().unwrap().from_browser = true;
        presence.publish(&browser);
        assert_eq!(discord.accept_activity()["details"], "In a browser");

        // Artwork Discord can already fetch.
        let mut with_art = playing("Has artwork");
        with_art.track.as_mut().unwrap().artwork_url = Some("https://example.com/a.jpg".into());
        presence.publish(&with_art);
        assert_eq!(discord.accept_activity()["details"], "Has artwork");

        // Playback that is not published at all: paused, and Spotify
        // while it is left to Discord.
        let mut paused = playing("Paused");
        paused.state = PlaybackState::Paused;
        presence.publish(&paused);
        assert!(discord.accept_activity().is_null());
        let mut spotify = playing("On Spotify");
        spotify.track.as_mut().unwrap().player.id = "com.spotify.client".into();
        presence.publish(&spotify);

        std::thread::sleep(Duration::from_millis(100));
        assert_eq!(searched(&searches), 0);

        presence.set_browser_lookups(true);
        presence.publish(&browser);
        wait_until("search", || searched(&searches) == 1);
    }

    #[test]
    fn unavailable_presence_ignores_everything() {
        let presence = DiscordPresence::unavailable();
        presence.configure(true, true);
        presence.publish(&playing("Song"));
        assert!(!presence.wants_playback());
        assert!(!presence.status().available);
    }
}
