//! Host-independent lyric fetch coordination. No runtime lock crosses an await.
use super::{lrclib::LrclibClient, LyricSource};
use crate::{
    domain::{NotFoundReason, TrackRef},
    runtime::LyraRuntime,
};
use std::{
    collections::HashSet,
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
    time::Duration,
};

/// Waits between automatic lookups after the playing track's lookup fails
/// for a transient reason. The error shows meanwhile; lyrics replace it as
/// soon as one succeeds.
const RETRY_DELAYS: [Duration; 4] = [
    Duration::from_secs(5),
    Duration::from_secs(15),
    Duration::from_secs(45),
    Duration::from_secs(120),
];

pub struct LyricsRefresh<S = LrclibClient> {
    source: S,
    in_flight: Mutex<HashSet<String>>,
    /// Bumped by every lookup of the playing track; an automatic retry that
    /// finds it changed hands over to the newer lookup.
    generation: AtomicU64,
    retry_delays: Vec<Duration>,
}

impl Default for LyricsRefresh {
    fn default() -> Self {
        Self::new(LrclibClient::new())
    }
}

impl<S: LyricSource> LyricsRefresh<S> {
    pub fn new(source: S) -> Self {
        Self {
            source,
            in_flight: Mutex::new(HashSet::new()),
            generation: AtomicU64::new(0),
            retry_delays: RETRY_DELAYS.to_vec(),
        }
    }

    pub async fn refresh(&self, runtime: &Mutex<LyraRuntime>) -> Result<(), String> {
        self.refresh_inner(runtime, false).await
    }

    pub async fn force_refresh(&self, runtime: &Mutex<LyraRuntime>) -> Result<(), String> {
        self.refresh_inner(runtime, true).await
    }

    async fn refresh_inner(&self, runtime: &Mutex<LyraRuntime>, force: bool) -> Result<(), String> {
        let track = {
            let rt = runtime.lock().map_err(|e| e.to_string())?;
            let Some(track) = rt.current_track() else {
                return Ok(());
            };
            // Browser media needs consent before its metadata leaves the
            // machine; manual retry does not bypass it.
            if rt.lookup_blocked(&track).is_some() {
                return Ok(());
            }
            // A manual retry bypasses the negative sentinel even if its queued
            // deletion has not reached disk yet. Existing lyric documents win.
            if (!force && rt.is_negative(&track.uri)) || rt.get_cached(&track.uri).is_some() {
                return Ok(());
            }
            track
        };
        let mut delays = self.retry_delays.iter();
        let mut forget = force;
        loop {
            let Some(generation) = self.lookup(runtime, &track, &mut forget).await? else {
                return Ok(());
            };
            let Some(delay) = delays.next() else {
                return Ok(());
            };
            tokio::time::sleep(*delay).await;
            if self.generation.load(Ordering::SeqCst) != generation
                || !Self::still_failing(runtime, &track.uri)?
            {
                return Ok(());
            }
        }
    }

    /// One lookup of the playing track. Returns its generation when it failed
    /// transiently and may be retried. The claim is released on return, so a
    /// manual retry can run while an automatic one waits, and takes it over.
    async fn lookup(
        &self,
        runtime: &Mutex<LyraRuntime>,
        track: &TrackRef,
        forget: &mut bool,
    ) -> Result<Option<u64>, String> {
        let Some(_claim) = FetchClaim::acquire(&self.in_flight, &track.uri)? else {
            return Ok(None);
        };
        if std::mem::take(forget) {
            runtime
                .lock()
                .map_err(|e| e.to_string())?
                .forget_track(&track.uri);
        }
        let generation = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        let outcome = self.fetch_and_store(runtime, track).await?;
        Ok((outcome == Outcome::Failed).then_some(generation))
    }

    /// The track is still playing, may still be looked up, and its last
    /// lookup failed transiently.
    fn still_failing(runtime: &Mutex<LyraRuntime>, uri: &str) -> Result<bool, String> {
        let rt = runtime.lock().map_err(|e| e.to_string())?;
        Ok(rt
            .current_track()
            .is_some_and(|track| track.uri == uri && rt.lookup_blocked(&track).is_none())
            && rt.has_transient_error(uri))
    }

    /// Look up a track that is not being followed, to settle whether it is
    /// music. The result goes to the cache only; it becomes the displayed
    /// document if the track is followed later. Consent, negative-cache and
    /// deduplication rules match `refresh`.
    pub async fn probe(
        &self,
        runtime: &Mutex<LyraRuntime>,
        track: &TrackRef,
    ) -> Result<(), String> {
        {
            let rt = runtime.lock().map_err(|e| e.to_string())?;
            if rt.lookup_blocked(track).is_some()
                || rt.is_negative(&track.uri)
                || rt.cache.has_lyrics(&track.uri)
            {
                return Ok(());
            }
        }
        let Some(_claim) = FetchClaim::acquire(&self.in_flight, &track.uri)? else {
            return Ok(());
        };
        self.fetch_and_store(runtime, track).await.map(drop)
    }

    /// Fetch without holding the runtime lock, then record the result.
    async fn fetch_and_store(
        &self,
        runtime: &Mutex<LyraRuntime>,
        track: &TrackRef,
    ) -> Result<Outcome, String> {
        let result = self.source.fetch(track).await;
        let mut rt = runtime.lock().map_err(|e| e.to_string())?;
        Ok(match result {
            Ok(Some(doc)) => {
                rt.store_lyrics(doc);
                Outcome::Settled
            }
            Ok(None) => {
                rt.store_negative(&track.uri);
                Outcome::Settled
            }
            Err(error) => {
                // Rate limits and overload get their own message: the server
                // answered, so the user's connection is fine.
                let reason = if error
                    .downcast_ref::<super::lrclib::LrclibHttpError>()
                    .is_some_and(|error| error.is_busy())
                {
                    NotFoundReason::RateLimit
                } else {
                    NotFoundReason::NetworkError
                };
                rt.store_transient_error(&track.uri, reason);
                Outcome::Failed
            }
        })
    }
}

#[derive(Debug, PartialEq, Eq)]
enum Outcome {
    Settled,
    Failed,
}

// Hold the claim through result storage; release it on completion or cancellation.
struct FetchClaim<'a> {
    in_flight: &'a Mutex<HashSet<String>>,
    uri: String,
}

impl<'a> FetchClaim<'a> {
    fn acquire(in_flight: &'a Mutex<HashSet<String>>, uri: &str) -> Result<Option<Self>, String> {
        if !in_flight
            .lock()
            .map_err(|e| e.to_string())?
            .insert(uri.to_owned())
        {
            return Ok(None);
        }
        Ok(Some(Self {
            in_flight,
            uri: uri.to_owned(),
        }))
    }
}

impl Drop for FetchClaim<'_> {
    fn drop(&mut self) {
        self.in_flight
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&self.uri);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{LyricDocument, LyricsStatus, PlaybackSnapshot, PlaybackState, TrackRef};
    use std::future::Future;
    use std::sync::atomic::{AtomicUsize, Ordering};

    struct Source {
        calls: AtomicUsize,
        fail: bool,
    }
    impl LyricSource for Source {
        fn name(&self) -> &str {
            "test"
        }
        async fn fetch(&self, _: &TrackRef) -> anyhow::Result<Option<LyricDocument>> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            if self.fail {
                anyhow::bail!("offline")
            }
            Ok(None)
        }
    }

    fn runtime(name: &str) -> Mutex<LyraRuntime> {
        let dir = std::env::temp_dir().join(format!("lyra-refresh-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let mut rt = LyraRuntime::new_in(dir);
        rt.set_playback_snapshot(PlaybackSnapshot {
            track: Some(TrackRef {
                duration_ms: 1000,
                ..TrackRef::fixture("spotify:track:test")
            }),
            state: PlaybackState::Paused,
            position_ms: Some(0),
            ..PlaybackSnapshot::stopped(0)
        });
        rt.tick();
        Mutex::new(rt)
    }

    /// Fails its first `failures` lookups, then finds synced lyrics.
    struct Flaky {
        calls: AtomicUsize,
        failures: usize,
    }
    impl LyricSource for Flaky {
        fn name(&self) -> &str {
            "flaky"
        }
        async fn fetch(&self, track: &TrackRef) -> anyhow::Result<Option<LyricDocument>> {
            if self.calls.fetch_add(1, Ordering::SeqCst) < self.failures {
                anyhow::bail!("offline")
            }
            Ok(Some(crate::lyrics::parser::parse_lrc(
                &track.uri,
                "[00:01.00]Found",
                crate::domain::LyricSourceKind::Lrclib,
            )?))
        }
    }

    fn flaky(failures: usize, delay_ms: u64) -> LyricsRefresh<Flaky> {
        let mut refresh = LyricsRefresh::new(Flaky {
            calls: AtomicUsize::new(0),
            failures,
        });
        refresh.retry_delays = vec![Duration::from_millis(delay_ms); 3];
        refresh
    }

    #[tokio::test]
    async fn transient_failure_is_not_persisted_as_a_miss() {
        let rt = runtime("transient");
        let mut refresh = LyricsRefresh::new(Source {
            calls: AtomicUsize::new(0),
            fail: true,
        });
        refresh.retry_delays = vec![Duration::from_millis(1); 2];
        refresh.refresh(&rt).await.unwrap();
        assert_eq!(refresh.source.calls.load(Ordering::SeqCst), 3);
        let mut rt = rt.lock().unwrap();
        assert!(!rt.is_negative("spotify:track:test"));
        assert!(matches!(
            rt.tick().lyrics_status,
            LyricsStatus::NotFound {
                reason: NotFoundReason::NetworkError
            }
        ));
    }

    #[tokio::test]
    async fn manual_retry_bypasses_persisted_negative_without_waiting_for_deletion() {
        let rt = runtime("retry");
        rt.lock()
            .unwrap()
            .cache
            .mark_negative("spotify:track:test")
            .unwrap();
        let refresh = LyricsRefresh::new(Source {
            calls: AtomicUsize::new(0),
            fail: false,
        });
        refresh.refresh(&rt).await.unwrap();
        assert_eq!(refresh.source.calls.load(Ordering::SeqCst), 0);
        refresh.force_refresh(&rt).await.unwrap();
        assert_eq!(refresh.source.calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn rate_limit_keeps_a_retryable_reason_without_a_negative_cache_entry() {
        struct Limited;
        impl LyricSource for Limited {
            fn name(&self) -> &str {
                "limited"
            }
            async fn fetch(&self, _: &TrackRef) -> anyhow::Result<Option<LyricDocument>> {
                Err(super::super::lrclib::LrclibHttpError { status: 429 }.into())
            }
        }
        let rt = runtime("rate-limit");
        let mut refresh = LyricsRefresh::new(Limited);
        refresh.retry_delays.clear();
        refresh.refresh(&rt).await.unwrap();
        let mut rt = rt.lock().unwrap();
        assert!(!rt.is_negative("spotify:track:test"));
        assert!(matches!(
            rt.tick().lyrics_status,
            LyricsStatus::NotFound {
                reason: NotFoundReason::RateLimit
            }
        ));
    }

    #[tokio::test]
    async fn playing_track_is_retried_until_lyrics_arrive() {
        let rt = runtime("auto-retry");
        let refresh = flaky(2, 1);
        refresh.refresh(&rt).await.unwrap();
        assert_eq!(refresh.source.calls.load(Ordering::SeqCst), 3);
        assert!(matches!(
            rt.lock().unwrap().tick().lyrics_status,
            LyricsStatus::Ready
        ));
    }

    #[tokio::test]
    async fn retries_stop_when_the_track_changes() {
        let rt = runtime("retry-skip");
        let refresh = flaky(usize::MAX, 40);
        let skip = async {
            tokio::time::sleep(Duration::from_millis(10)).await;
            let mut guard = rt.lock().unwrap();
            let mut snapshot = guard.last_playback_snapshot.clone().unwrap();
            snapshot.track = Some(TrackRef::fixture("spotify:track:next"));
            guard.set_playback_snapshot(snapshot);
        };
        let (result, ()) = tokio::join!(refresh.refresh(&rt), skip);
        result.unwrap();
        assert_eq!(refresh.source.calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn manual_retry_takes_over_a_waiting_automatic_retry() {
        let rt = runtime("retry-manual");
        let mut refresh = flaky(usize::MAX, 0);
        refresh.retry_delays = vec![Duration::from_millis(100)];
        let manual = async {
            tokio::time::sleep(Duration::from_millis(20)).await;
            refresh.force_refresh(&rt).await
        };
        let (automatic, manual) = tokio::join!(refresh.refresh(&rt), manual);
        automatic.unwrap();
        manual.unwrap();
        // First lookup, the manual one, and the manual one's single retry;
        // the superseded automatic retry never runs.
        assert_eq!(refresh.source.calls.load(Ordering::SeqCst), 3);
    }

    #[tokio::test]
    async fn concurrent_fetch_is_deduplicated_and_cancellation_releases_claim() {
        struct PendingSource;
        impl LyricSource for PendingSource {
            fn name(&self) -> &str {
                "pending"
            }
            async fn fetch(&self, _: &TrackRef) -> anyhow::Result<Option<LyricDocument>> {
                std::future::pending().await
            }
        }
        let rt = runtime("cancel");
        let refresh = LyricsRefresh::new(PendingSource);
        let mut first = Box::pin(refresh.refresh(&rt));
        std::future::poll_fn(|cx| {
            assert!(first.as_mut().poll(cx).is_pending());
            std::task::Poll::Ready(())
        })
        .await;
        assert!(
            rt.try_lock().is_ok(),
            "network wait must release runtime lock"
        );
        refresh.refresh(&rt).await.unwrap();
        drop(first);
        assert!(refresh.in_flight.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn browser_media_waits_for_consent_even_on_manual_retry() {
        use crate::domain::BrowserLyrics;
        let rt = runtime("consent");
        {
            let mut guard = rt.lock().unwrap();
            let mut snapshot = guard.last_playback_snapshot.clone().unwrap();
            snapshot.track.as_mut().unwrap().from_browser = true;
            guard.set_playback_snapshot(snapshot);
            assert!(matches!(
                guard.tick().lyrics_status,
                LyricsStatus::NotFound {
                    reason: NotFoundReason::ConsentRequired
                }
            ));
        }
        let refresh = LyricsRefresh::new(Source {
            calls: AtomicUsize::new(0),
            fail: false,
        });
        refresh.refresh(&rt).await.unwrap();
        refresh.force_refresh(&rt).await.unwrap();
        assert_eq!(refresh.source.calls.load(Ordering::SeqCst), 0);

        {
            let mut guard = rt.lock().unwrap();
            let mut settings = guard.settings().clone();
            settings.behavior.browser_lyrics = BrowserLyrics::Deny;
            guard.update_settings(settings.clone());
            assert!(matches!(
                guard.tick().lyrics_status,
                LyricsStatus::NotFound {
                    reason: NotFoundReason::LookupDisabled
                }
            ));
            settings.behavior.browser_lyrics = BrowserLyrics::Allow;
            guard.update_settings(settings);
            assert!(matches!(guard.tick().lyrics_status, LyricsStatus::Loading));
        }
        refresh.refresh(&rt).await.unwrap();
        assert_eq!(refresh.source.calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn probe_caches_a_track_without_making_it_current() {
        let rt = runtime("probe");
        let refresh = LyricsRefresh::new(Source {
            calls: AtomicUsize::new(0),
            fail: false,
        });
        let other = TrackRef::fixture("meta::other::song::200");
        refresh.probe(&rt, &other).await.unwrap();
        assert_eq!(refresh.source.calls.load(Ordering::SeqCst), 1);
        // Cache writes are scheduled on the runtime; let them run.
        tokio::task::yield_now().await;
        // A confirmed miss is cached; the followed track is untouched.
        {
            let guard = rt.lock().unwrap();
            assert!(guard.is_negative("meta::other::song::200"));
            assert_eq!(guard.current_track().unwrap().uri, "spotify:track:test");
        }
        // Already settled: no second request.
        refresh.probe(&rt, &other).await.unwrap();
        assert_eq!(refresh.source.calls.load(Ordering::SeqCst), 1);

        // Browser media without consent is never probed.
        let browser = TrackRef {
            from_browser: true,
            ..TrackRef::fixture("meta::browser::song::200")
        };
        refresh.probe(&rt, &browser).await.unwrap();
        assert_eq!(refresh.source.calls.load(Ordering::SeqCst), 1);
    }
}
