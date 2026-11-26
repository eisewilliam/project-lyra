//! The user's own lyrics for a track: another provider match they choose, or
//! a file they add. Both are saved as an override, which wins over the
//! automatic match until the user goes back to it.
use super::refresh::{failure_reason, LyricsRefresh};
use super::{import, LyricSource};
use crate::domain::{
    LyricCandidate, LyricCandidates, LyricChoiceError, LyricDocument, LyricSearchQuery,
    LyricsOrigin, NotFoundReason, TrackRef,
};
use crate::runtime::LyraRuntime;
use std::sync::{Mutex, MutexGuard};

impl<S: LyricSource> LyricsRefresh<S> {
    /// Provider matches for the playing track, searched with `query` or with
    /// the track's own title and artist. Browser media needs the user's
    /// consent first, as for automatic lookups.
    pub async fn candidates(
        &self,
        runtime: &Mutex<LyraRuntime>,
        query: Option<LyricSearchQuery>,
    ) -> Result<LyricCandidates, LyricChoiceError> {
        let track = lookup_track(runtime)?;
        let query = query
            .map(|query| LyricSearchQuery {
                title: query.title.trim().to_owned(),
                artist: query.artist.trim().to_owned(),
            })
            .filter(|query| !query.title.is_empty())
            .unwrap_or_else(|| LyricSearchQuery {
                title: track.title.clone(),
                artist: track.artist.clone(),
            });
        let mut candidates = self
            .source
            .candidates(&track, &query)
            .await
            .map_err(|error| provider_error(&error))?;
        let (showing, picked) = {
            let rt = lock(runtime)?;
            let same_track = rt
                .current_track()
                .is_some_and(|current| current.uri == track.uri);
            let picked = match rt.current_origin() {
                LyricsOrigin::Picked { id } => *id,
                _ => None,
            };
            (
                same_track.then(|| rt.current_fingerprint()).flatten(),
                picked,
            )
        };
        // Matches often share their text (one per album), so mark only one:
        // the match the user picked, else the first with the showing text.
        let matching = |c: &&LyricCandidate| Some(c.fingerprint) == showing;
        let marked = candidates
            .iter()
            .filter(matching)
            .find(|c| Some(c.id) == picked)
            .or_else(|| candidates.iter().find(matching))
            .map(|c| c.id);
        for candidate in &mut candidates {
            candidate.current = Some(candidate.id) == marked;
        }
        Ok(LyricCandidates {
            track_key: track.uri,
            query,
            candidates,
        })
    }

    /// Show the provider match `id` for `track_key`, which must still be
    /// playing.
    pub async fn choose(
        &self,
        runtime: &Mutex<LyraRuntime>,
        track_key: &str,
        id: i64,
    ) -> Result<(), LyricChoiceError> {
        if lookup_track(runtime)?.uri != track_key {
            return Err(LyricChoiceError::TrackChanged);
        }
        let doc = self
            .source
            .fetch_by_id(track_key, id)
            .await
            .map_err(|error| provider_error(&error))?
            .ok_or(LyricChoiceError::Gone)?;
        self.save_user_lyrics(runtime, doc, LyricsOrigin::Picked { id: Some(id) })
    }

    /// Use the lyrics in a file the user added for `track_key`: the track
    /// that was playing when they asked, shown now if it still is. Local, so
    /// browser media needs no consent.
    pub fn import(
        &self,
        runtime: &Mutex<LyraRuntime>,
        track_key: &str,
        bytes: &[u8],
        file_name: Option<String>,
    ) -> Result<(), LyricChoiceError> {
        let doc = import::parse_user_lyrics(track_key, bytes)?;
        self.save_user_lyrics(runtime, doc, LyricsOrigin::Imported { name: file_name })
    }

    /// Go back to the automatic lyrics for the playing track. When none are
    /// cached the status turns to loading, and the views look them up.
    pub fn reset_choice(&self, runtime: &Mutex<LyraRuntime>) -> Result<(), LyricChoiceError> {
        let _saving = self.saving.lock().unwrap_or_else(|e| e.into_inner());
        let (key, cache) = {
            let rt = lock(runtime)?;
            let track = rt.current_track().ok_or(LyricChoiceError::NoTrack)?;
            (track.uri, rt.cache.clone())
        };
        cache
            .remove_override(&key)
            .map_err(|_| LyricChoiceError::SaveFailed)?;
        lock(runtime)?.reload_lyrics(&key);
        Ok(())
    }

    /// Save, then show. Disk writes happen outside the runtime lock; a lookup
    /// that lands in between finds the saved override and leaves it alone.
    pub(super) fn save_user_lyrics(
        &self,
        runtime: &Mutex<LyraRuntime>,
        doc: LyricDocument,
        origin: LyricsOrigin,
    ) -> Result<(), LyricChoiceError> {
        let _saving = self.saving.lock().unwrap_or_else(|e| e.into_inner());
        let cache = lock(runtime)?.cache.clone();
        cache
            .put_override(&doc, &origin)
            .map_err(|_| LyricChoiceError::SaveFailed)?;
        lock(runtime)?.apply_user_lyrics(doc, origin);
        Ok(())
    }
}

/// The playing track, when Lyra may look up lyrics for it.
fn lookup_track(runtime: &Mutex<LyraRuntime>) -> Result<TrackRef, LyricChoiceError> {
    let rt = lock(runtime)?;
    let track = rt.current_track().ok_or(LyricChoiceError::NoTrack)?;
    match rt.lookup_blocked(&track) {
        None => Ok(track),
        Some(NotFoundReason::ConsentRequired) => Err(LyricChoiceError::ConsentRequired),
        Some(_) => Err(LyricChoiceError::LookupDisabled),
    }
}

fn provider_error(error: &anyhow::Error) -> LyricChoiceError {
    match failure_reason(error) {
        NotFoundReason::RateLimit => LyricChoiceError::RateLimit,
        _ => LyricChoiceError::NetworkError,
    }
}

fn lock(runtime: &Mutex<LyraRuntime>) -> Result<MutexGuard<'_, LyraRuntime>, LyricChoiceError> {
    runtime.lock().map_err(|_| LyricChoiceError::SaveFailed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{
        BrowserLyrics, CandidateFit, LyricCandidate, LyricSourceKind, LyricsStatus,
        PlaybackSnapshot, PlaybackState,
    };
    use crate::lyrics::{fingerprint, parser::parse_lrc};

    const KEY: &str = "spotify:track:choice";
    const AUTO: &str = "[00:01.00]Automatic";
    const CHOSEN: &str = "[00:01.00]Chosen";

    /// Offers the automatic lyrics, one other match, and a second match
    /// with the automatic text (as another album's release would have).
    struct Matches;
    impl LyricSource for Matches {
        fn name(&self) -> &str {
            "matches"
        }
        async fn fetch(&self, track: &TrackRef) -> anyhow::Result<Option<LyricDocument>> {
            Ok(Some(parse_lrc(&track.uri, AUTO, LyricSourceKind::Lrclib)?))
        }
        async fn candidates(
            &self,
            _: &TrackRef,
            _: &LyricSearchQuery,
        ) -> anyhow::Result<Vec<LyricCandidate>> {
            Ok([(1, AUTO), (7, CHOSEN), (8, AUTO)]
                .into_iter()
                .map(|(id, text)| LyricCandidate {
                    id,
                    title: "Song".into(),
                    artist: "Artist".into(),
                    album: None,
                    duration_ms: Some(1000),
                    synced: true,
                    fit: CandidateFit::Good,
                    preview: vec![],
                    current: false,
                    fingerprint: fingerprint(text),
                })
                .collect())
        }
        async fn fetch_by_id(
            &self,
            track_key: &str,
            id: i64,
        ) -> anyhow::Result<Option<LyricDocument>> {
            let text = match id {
                7 => CHOSEN,
                8 => AUTO,
                _ => return Ok(None),
            };
            parse_lrc(track_key, text, LyricSourceKind::Lrclib).map(Some)
        }
    }

    fn runtime(name: &str, from_browser: bool) -> Mutex<LyraRuntime> {
        let dir = std::env::temp_dir().join(format!("lyra-choice-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let mut rt = LyraRuntime::new_in(dir);
        rt.set_playback_snapshot(PlaybackSnapshot {
            track: Some(TrackRef {
                duration_ms: 1000,
                from_browser,
                ..TrackRef::fixture(KEY)
            }),
            state: PlaybackState::Paused,
            position_ms: Some(0),
            ..PlaybackSnapshot::stopped(0)
        });
        rt.tick();
        Mutex::new(rt)
    }

    fn first_line(rt: &Mutex<LyraRuntime>) -> String {
        rt.lock().unwrap().all_lyrics_lines().remove(0)
    }

    #[tokio::test]
    async fn chosen_match_survives_a_late_lookup_until_reset() {
        let rt = runtime("choose", false);
        let refresh = LyricsRefresh::new(Matches);
        let auto = parse_lrc(KEY, AUTO, LyricSourceKind::Lrclib).unwrap();
        {
            let mut guard = rt.lock().unwrap();
            guard.cache.put_document(&auto).unwrap();
            guard.store_lyrics(auto.clone());
            guard.set_current_offset(400);
        }

        let list = refresh.candidates(&rt, None).await.unwrap();
        assert_eq!(list.track_key, KEY);
        let current: Vec<_> = list.candidates.iter().map(|c| c.current).collect();
        assert_eq!(
            current,
            [true, false, false],
            "only the first match with the showing text is marked"
        );

        let before = rt.lock().unwrap().tick().lyrics_revision;
        refresh.choose(&rt, KEY, 7).await.unwrap();
        let render = rt.lock().unwrap().tick();
        assert_eq!(render.lyrics_origin, LyricsOrigin::Picked { id: Some(7) });
        assert_ne!(render.lyrics_revision, before);
        assert_eq!(first_line(&rt), "Chosen");
        assert_eq!(rt.lock().unwrap().current_offset(), 0, "offset starts over");

        // A lookup landing after the choice only fills the cache.
        rt.lock().unwrap().store_lyrics(auto);
        assert_eq!(first_line(&rt), "Chosen");
        let list = refresh.candidates(&rt, None).await.unwrap();
        let current: Vec<_> = list.candidates.iter().map(|c| c.current).collect();
        assert_eq!(current, [false, true, false]);

        refresh.choose(&rt, KEY, 8).await.unwrap();
        let list = refresh.candidates(&rt, None).await.unwrap();
        let current: Vec<_> = list.candidates.iter().map(|c| c.current).collect();
        assert_eq!(
            current,
            [false, false, true],
            "the picked duplicate is marked"
        );

        refresh.reset_choice(&rt).unwrap();
        let render = rt.lock().unwrap().tick();
        assert_eq!(render.lyrics_origin, LyricsOrigin::Automatic);
        assert_eq!(first_line(&rt), "Automatic");
    }

    #[tokio::test]
    async fn custom_search_is_trimmed_and_blank_titles_use_the_track() {
        let rt = runtime("query", false);
        let refresh = LyricsRefresh::new(Matches);
        let typed = LyricSearchQuery {
            title: "  Other Song ".into(),
            artist: " Someone ".into(),
        };
        let list = refresh.candidates(&rt, Some(typed)).await.unwrap();
        assert_eq!(list.query.title, "Other Song");
        assert_eq!(list.query.artist, "Someone");
        let blank = LyricSearchQuery {
            title: "   ".into(),
            artist: "Someone".into(),
        };
        let list = refresh.candidates(&rt, Some(blank)).await.unwrap();
        let track = rt.lock().unwrap().current_track().unwrap();
        assert_eq!(list.query.title, track.title);
        assert_eq!(list.query.artist, track.artist);
    }

    #[tokio::test]
    async fn choosing_needs_the_same_track_and_an_existing_match() {
        let rt = runtime("stale", false);
        let refresh = LyricsRefresh::new(Matches);
        assert_eq!(
            refresh.choose(&rt, "spotify:track:other", 7).await,
            Err(LyricChoiceError::TrackChanged)
        );
        assert_eq!(
            refresh.choose(&rt, KEY, 99).await,
            Err(LyricChoiceError::Gone)
        );
    }

    #[tokio::test]
    async fn browser_media_needs_consent_to_search_but_not_to_import() {
        let rt = runtime("consent", true);
        let refresh = LyricsRefresh::new(Matches);
        assert_eq!(
            refresh.candidates(&rt, None).await.unwrap_err(),
            LyricChoiceError::ConsentRequired
        );
        assert_eq!(
            refresh.choose(&rt, KEY, 7).await,
            Err(LyricChoiceError::ConsentRequired)
        );
        {
            let mut guard = rt.lock().unwrap();
            let mut settings = guard.settings().clone();
            settings.behavior.browser_lyrics = BrowserLyrics::Deny;
            guard.update_settings(settings);
        }
        assert_eq!(
            refresh.candidates(&rt, None).await.unwrap_err(),
            LyricChoiceError::LookupDisabled
        );

        refresh
            .import(&rt, KEY, b"Verse one\nVerse two", Some("song.txt".into()))
            .unwrap();
        let render = rt.lock().unwrap().tick();
        assert!(matches!(render.lyrics_status, LyricsStatus::Unsynced));
        assert_eq!(
            render.lyrics_origin,
            LyricsOrigin::Imported {
                name: Some("song.txt".into())
            }
        );
        assert_eq!(
            rt.lock().unwrap().all_plain_lyrics().as_deref(),
            Some("Verse one\nVerse two")
        );
    }

    #[tokio::test]
    async fn reset_without_cached_lyrics_waits_for_a_lookup() {
        let rt = runtime("reset", false);
        let refresh = LyricsRefresh::new(Matches);
        refresh.import(&rt, KEY, b"[00:01.00]Mine", None).unwrap();
        assert!(matches!(
            rt.lock().unwrap().tick().lyrics_status,
            LyricsStatus::Ready
        ));
        refresh.reset_choice(&rt).unwrap();
        assert!(matches!(
            rt.lock().unwrap().tick().lyrics_status,
            LyricsStatus::Loading
        ));
        refresh.refresh(&rt).await.unwrap();
        assert_eq!(first_line(&rt), "Automatic");
    }
}
