//! Players Lyra has seen, remembered so settings can configure them while
//! they are not running. Stores only app identity and when it was last seen,
//! never track information. Persisted as `known_players.json`.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::domain::{PlayerApp, Transport};

/// Least recently seen players are dropped beyond this many.
const MAX_KNOWN_PLAYERS: usize = 50;
/// Last-seen times are written at most this often; new players and renames
/// are written immediately.
const SAVE_INTERVAL_MS: u64 = 60 * 60 * 1000;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct KnownPlayer {
    pub app: PlayerApp,
    pub transport: Transport,
    pub last_seen_ms: u64,
}

#[derive(Default)]
pub struct KnownPlayers {
    players: Vec<KnownPlayer>,
    path: Option<PathBuf>,
    last_saved_ms: u64,
}

impl KnownPlayers {
    /// Load from `known_players.json` in the host-selected directory.
    pub fn load(app_support_dir: &Path) -> Self {
        let path = app_support_dir.join("known_players.json");
        let players = std::fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        Self {
            players,
            path: Some(path),
            last_saved_ms: 0,
        }
    }

    pub fn list(&self) -> &[KnownPlayer] {
        &self.players
    }

    /// Record the players seen in one poll round.
    pub fn record<'a>(
        &mut self,
        seen: impl IntoIterator<Item = (&'a PlayerApp, Transport)>,
        now_ms: u64,
    ) {
        let mut changed = false;
        for (app, transport) in seen {
            match self.players.iter_mut().find(|p| p.app.id == app.id) {
                Some(known) => {
                    if known.app.name != app.name || known.transport != transport {
                        known.app.name = app.name.clone();
                        known.transport = transport;
                        changed = true;
                    }
                    known.last_seen_ms = now_ms;
                }
                None => {
                    self.players.push(KnownPlayer {
                        app: app.clone(),
                        transport,
                        last_seen_ms: now_ms,
                    });
                    changed = true;
                }
            }
        }
        if self.players.len() > MAX_KNOWN_PLAYERS {
            self.players
                .sort_by_key(|p| std::cmp::Reverse(p.last_seen_ms));
            self.players.truncate(MAX_KNOWN_PLAYERS);
        }
        if changed || now_ms.saturating_sub(self.last_saved_ms) >= SAVE_INTERVAL_MS {
            self.save(now_ms);
        }
    }

    /// Remove a player; it reappears if it plays again.
    pub fn forget(&mut self, app_id: &str, now_ms: u64) -> bool {
        let before = self.players.len();
        self.players.retain(|p| p.app.id != app_id);
        let removed = self.players.len() != before;
        if removed {
            self.save(now_ms);
        }
        removed
    }

    fn save(&mut self, now_ms: u64) {
        self.last_saved_ms = now_ms;
        let Some(path) = &self.path else { return };
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Ok(json) = serde_json::to_string_pretty(&self.players) {
            let _ = std::fs::write(path, json);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn app(id: &str, name: &str) -> PlayerApp {
        PlayerApp {
            id: id.into(),
            name: name.into(),
        }
    }

    #[test]
    fn records_updates_and_forgets_players_across_restarts() {
        let dir = std::env::temp_dir().join(format!("lyra-known-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let mut known = KnownPlayers::load(&dir);
        let spotify = app("com.spotify.client", "Spotify");
        known.record([(&spotify, Transport::AppleScript)], 1_000);
        known.record([(&spotify, Transport::AppleScript)], 2_000);
        assert_eq!(known.list().len(), 1);
        assert_eq!(known.list()[0].last_seen_ms, 2_000);

        // Last-seen updates are written lazily, not on every poll.
        assert_eq!(KnownPlayers::load(&dir).list()[0].last_seen_ms, 1_000);

        let ytm = app("com.google.Chrome.app.x", "YouTube Music");
        known.record([(&ytm, Transport::MediaRemote)], 3_000);
        assert_eq!(
            KnownPlayers::load(&dir).list().len(),
            2,
            "new players save at once"
        );

        assert!(known.forget("com.spotify.client", 4_000));
        let reloaded = KnownPlayers::load(&dir);
        assert_eq!(reloaded.list().len(), 1);
        assert_eq!(reloaded.list()[0].app.name, "YouTube Music");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn list_is_bounded_by_recency() {
        let mut known = KnownPlayers::default();
        for i in 0..MAX_KNOWN_PLAYERS + 5 {
            let a = app(&format!("app{i}"), "App");
            known.record([(&a, Transport::Smtc)], i as u64);
        }
        assert_eq!(known.list().len(), MAX_KNOWN_PLAYERS);
        assert!(known.list().iter().all(|p| p.app.id != "app0"));
    }
}
