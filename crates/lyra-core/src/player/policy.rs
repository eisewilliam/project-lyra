//! Which media Lyra follows: the user's rules and overrides combined with
//! classification and lyric-lookup results. Persisted as
//! `media_policy.json` in the host-selected app directory.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::classify::Classification;
use crate::domain::{FollowRule, IgnoreReason, MediaKind, MediaPolicyView, PlayerApp};

/// Oldest per-track overrides are dropped beyond this many.
const MAX_TRACK_OVERRIDES: usize = 500;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct MediaPolicy {
    /// Follow only this app; `None` selects players automatically.
    pub pinned_app: Option<PlayerApp>,
    pub only_music: bool,
    pub app_rules: BTreeMap<String, FollowRule>,
    /// Per-track overrides by track key, oldest first; `true` = music.
    pub track_overrides: Vec<(String, bool)>,
}

impl Default for MediaPolicy {
    fn default() -> Self {
        Self {
            pinned_app: None,
            only_music: true,
            app_rules: BTreeMap::new(),
            track_overrides: Vec::new(),
        }
    }
}

impl MediaPolicy {
    pub fn view(&self) -> MediaPolicyView {
        MediaPolicyView {
            pinned_app: self.pinned_app.clone(),
            only_music: self.only_music,
            app_rules: self.app_rules.clone(),
        }
    }

    pub fn app_rule(&self, app_id: &str) -> FollowRule {
        self.app_rules.get(app_id).copied().unwrap_or_default()
    }

    pub fn set_app_rule(&mut self, app_id: &str, rule: FollowRule) {
        if rule == FollowRule::Auto {
            self.app_rules.remove(app_id);
        } else {
            self.app_rules.insert(app_id.to_string(), rule);
        }
    }

    pub fn track_override(&self, track_key: &str) -> Option<bool> {
        self.track_overrides
            .iter()
            .rev()
            .find(|(key, _)| key == track_key)
            .map(|(_, is_music)| *is_music)
    }

    /// `None` clears the override.
    pub fn set_track_override(&mut self, track_key: &str, is_music: Option<bool>) {
        self.track_overrides.retain(|(key, _)| key != track_key);
        if let Some(is_music) = is_music {
            self.track_overrides.push((track_key.to_string(), is_music));
            let excess = self
                .track_overrides
                .len()
                .saturating_sub(MAX_TRACK_OVERRIDES);
            self.track_overrides.drain(..excess);
        }
    }
}

/// What the lyric cache says about a track Lyra could not classify.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LyricVerdict {
    Found,
    Missing,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Decision {
    pub kind: MediaKind,
    /// `None` means follow.
    pub ignored: Option<IgnoreReason>,
    /// Look the track up in the background to settle whether it is music.
    pub probe: bool,
}

/// The track facts the decision needs.
#[derive(Debug, Clone, Copy)]
pub struct Subject<'a> {
    pub app_id: &'a str,
    pub track_key: &'a str,
    pub from_browser: bool,
}

/// Precedence: a selected (pinned) player, per-track override, per-app rule,
/// the global "only music" switch, then classification refined by the lyric
/// verdict. A pinned player's media is followed whatever it is, unless the
/// user marked that track as not music; every other player is ignored. Unsure native
/// apps are followed; unsure browser media is checked against LRCLIB when
/// lookups are allowed and ignored otherwise.
pub fn decide(
    policy: &MediaPolicy,
    subject: Subject<'_>,
    class: Classification,
    verdict: LyricVerdict,
    lookups_allowed: bool,
) -> Decision {
    let kind = match (class.kind, verdict) {
        (MediaKind::Unsure, LyricVerdict::Found) => MediaKind::Music,
        (MediaKind::Unsure, LyricVerdict::Missing) => MediaKind::NotMusic,
        (kind, _) => kind,
    };
    let follow = |kind| Decision {
        kind,
        ignored: None,
        probe: false,
    };
    let ignore = |kind, reason| Decision {
        kind,
        ignored: Some(reason),
        probe: false,
    };

    if let Some(pinned) = &policy.pinned_app {
        if pinned.id != subject.app_id {
            return ignore(kind, IgnoreReason::OtherPlayerSelected);
        }
        return if policy.track_override(subject.track_key) == Some(false) {
            ignore(MediaKind::NotMusic, IgnoreReason::MarkedNotMusic)
        } else {
            follow(kind)
        };
    }
    if let Some(is_music) = policy.track_override(subject.track_key) {
        return if is_music {
            follow(MediaKind::Music)
        } else {
            ignore(MediaKind::NotMusic, IgnoreReason::MarkedNotMusic)
        };
    }
    match policy.app_rule(subject.app_id) {
        FollowRule::Always => return follow(kind),
        FollowRule::Never => return ignore(kind, IgnoreReason::AppRule),
        FollowRule::Auto => {}
    }
    if !policy.only_music {
        return follow(kind);
    }
    match kind {
        MediaKind::Music => follow(kind),
        MediaKind::NotMusic => ignore(kind, class.reason.unwrap_or(IgnoreReason::NoLyricsFound)),
        MediaKind::Unsure if !subject.from_browser => follow(kind),
        MediaKind::Unsure if lookups_allowed => Decision {
            kind,
            ignored: Some(IgnoreReason::Checking),
            probe: true,
        },
        MediaKind::Unsure => ignore(kind, IgnoreReason::Unconfirmed),
    }
}

#[derive(Clone)]
pub struct MediaPolicyStore {
    path: PathBuf,
}

impl MediaPolicyStore {
    pub fn new(app_support_dir: &Path) -> Self {
        Self {
            path: app_support_dir.join("media_policy.json"),
        }
    }

    pub fn load(&self) -> MediaPolicy {
        std::fs::read_to_string(&self.path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, policy: &MediaPolicy) -> anyhow::Result<()> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(&self.path, serde_json::to_string_pretty(policy)?)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const BROWSER: Subject<'static> = Subject {
        app_id: "com.google.Chrome",
        track_key: "meta::a",
        from_browser: true,
    };

    fn class(kind: MediaKind, reason: Option<IgnoreReason>) -> Classification {
        Classification {
            kind,
            platform: None,
            reason,
        }
    }

    #[test]
    fn music_is_followed_and_non_music_ignored_by_default() {
        let p = MediaPolicy::default();
        let d = decide(
            &p,
            BROWSER,
            class(MediaKind::Music, None),
            LyricVerdict::Unknown,
            false,
        );
        assert_eq!(d.ignored, None);
        let d = decide(
            &p,
            BROWSER,
            class(MediaKind::NotMusic, Some(IgnoreReason::Podcast)),
            LyricVerdict::Unknown,
            true,
        );
        assert_eq!(d.ignored, Some(IgnoreReason::Podcast));
    }

    #[test]
    fn unsure_browser_media_is_checked_or_ignored() {
        let p = MediaPolicy::default();
        let unsure = class(MediaKind::Unsure, None);
        let d = decide(&p, BROWSER, unsure, LyricVerdict::Unknown, true);
        assert_eq!((d.ignored, d.probe), (Some(IgnoreReason::Checking), true));
        let d = decide(&p, BROWSER, unsure, LyricVerdict::Unknown, false);
        assert_eq!(
            (d.ignored, d.probe),
            (Some(IgnoreReason::Unconfirmed), false)
        );
        let d = decide(&p, BROWSER, unsure, LyricVerdict::Found, false);
        assert_eq!((d.kind, d.ignored), (MediaKind::Music, None));
        let d = decide(&p, BROWSER, unsure, LyricVerdict::Missing, true);
        assert_eq!(d.ignored, Some(IgnoreReason::NoLyricsFound));
        // Native apps are usually music players: follow when unsure.
        let native = Subject {
            from_browser: false,
            ..BROWSER
        };
        assert_eq!(
            decide(&p, native, unsure, LyricVerdict::Unknown, false).ignored,
            None
        );
    }

    #[test]
    fn overrides_take_precedence_in_order() {
        let mut p = MediaPolicy::default();
        let not_music = class(MediaKind::NotMusic, Some(IgnoreReason::NotMusicSignals));
        p.set_app_rule("com.google.Chrome", FollowRule::Always);
        assert_eq!(
            decide(&p, BROWSER, not_music, LyricVerdict::Unknown, false).ignored,
            None
        );
        p.set_track_override("meta::a", Some(false));
        assert_eq!(
            decide(&p, BROWSER, not_music, LyricVerdict::Unknown, false).ignored,
            Some(IgnoreReason::MarkedNotMusic)
        );
        p.set_track_override("meta::a", None);
        p.set_app_rule("com.google.Chrome", FollowRule::Never);
        let music = class(MediaKind::Music, None);
        assert_eq!(
            decide(&p, BROWSER, music, LyricVerdict::Unknown, false).ignored,
            Some(IgnoreReason::AppRule)
        );
        p.set_app_rule("com.google.Chrome", FollowRule::Auto);
        assert!(p.app_rules.is_empty());
        p.only_music = false;
        assert_eq!(
            decide(&p, BROWSER, not_music, LyricVerdict::Unknown, false).ignored,
            None
        );
    }

    #[test]
    fn pinned_player_is_followed_whatever_it_plays_and_others_ignored() {
        let mut p = MediaPolicy {
            pinned_app: Some(PlayerApp {
                id: "com.google.Chrome".into(),
                name: "Google Chrome".into(),
            }),
            ..MediaPolicy::default()
        };
        let not_music = class(MediaKind::NotMusic, Some(IgnoreReason::NotMusicSignals));
        assert_eq!(
            decide(&p, BROWSER, not_music, LyricVerdict::Unknown, false).ignored,
            None
        );
        let spotify = Subject {
            app_id: "com.spotify.client",
            track_key: "spotify:track:1",
            from_browser: false,
        };
        let music = class(MediaKind::Music, None);
        assert_eq!(
            decide(&p, spotify, music, LyricVerdict::Unknown, false).ignored,
            Some(IgnoreReason::OtherPlayerSelected)
        );
        // Marking the pinned player's track as not music still applies.
        p.set_track_override("meta::a", Some(false));
        assert_eq!(
            decide(&p, BROWSER, music, LyricVerdict::Unknown, false).ignored,
            Some(IgnoreReason::MarkedNotMusic)
        );
    }

    #[test]
    fn track_overrides_are_bounded_and_latest_wins() {
        let mut p = MediaPolicy::default();
        for i in 0..MAX_TRACK_OVERRIDES + 10 {
            p.set_track_override(&format!("k{i}"), Some(true));
        }
        assert_eq!(p.track_overrides.len(), MAX_TRACK_OVERRIDES);
        assert_eq!(p.track_override("k0"), None);
        p.set_track_override("k20", Some(false));
        assert_eq!(p.track_override("k20"), Some(false));
    }

    #[test]
    fn store_roundtrips_and_defaults() {
        let dir = std::env::temp_dir().join(format!("lyra-policy-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let store = MediaPolicyStore::new(&dir);
        assert_eq!(store.load(), MediaPolicy::default());
        let mut p = MediaPolicy::default();
        p.set_app_rule("x", FollowRule::Never);
        p.set_track_override("k", Some(true));
        store.save(&p).unwrap();
        assert_eq!(store.load(), p);
        let _ = std::fs::remove_dir_all(dir);
    }
}
