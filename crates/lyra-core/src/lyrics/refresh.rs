//! Host-independent lyric fetch coordination. No runtime lock crosses an await.
use super::{lrclib::LrclibClient, LyricSource};
use crate::{domain::NotFoundReason, runtime::LyraRuntime};
use std::{collections::HashSet, sync::Mutex};

pub struct LyricsRefresh<S = LrclibClient> {
    source: S,
    in_flight: Mutex<HashSet<String>>,
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
            // A manual retry bypasses the negative sentinel even if its queued
            // deletion has not reached disk yet. Existing lyric documents win.
            if (!force && rt.is_negative(&track.uri)) || rt.get_cached(&track.uri).is_some() {
                return Ok(());
            }
            track
        };
        let Some(_claim) = FetchClaim::acquire(&self.in_flight, &track.uri)? else {
            return Ok(());
        };
        if force {
            runtime
                .lock()
                .map_err(|e| e.to_string())?
                .forget_track(&track.uri);
        }
        let result = self.source.fetch(&track).await;
        let mut rt = runtime.lock().map_err(|e| e.to_string())?;
        match result {
            Ok(Some(doc)) => rt.store_lyrics(doc),
            Ok(None) => rt.store_negative(&track.uri),
            Err(error) => {
                let reason = if error
                    .downcast_ref::<super::lrclib::LrclibHttpError>()
                    .is_some_and(|error| error.is_rate_limit())
                {
                    NotFoundReason::RateLimit
                } else {
                    NotFoundReason::NetworkError
                };
                rt.store_transient_error(&track.uri, reason);
            }
        }
        Ok(())
    }
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
    use crate::domain::{
        LyricDocument, LyricsStatus, PlaybackSnapshot, PlaybackState, PlayerSource, TrackRef,
    };
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
                source: PlayerSource::SpotifyMacOs,
                uri: "spotify:track:test".into(),
                title: "test".into(),
                artist: "test".into(),
                album: None,
                duration_ms: 1000,
                artwork_url: None,
            }),
            state: PlaybackState::Paused,
            position_ms: Some(0),
            observed_at_ms: 0,
        });
        rt.tick();
        Mutex::new(rt)
    }

    #[tokio::test]
    async fn transient_failure_is_not_persisted_as_a_miss() {
        let rt = runtime("transient");
        let refresh = LyricsRefresh::new(Source {
            calls: AtomicUsize::new(0),
            fail: true,
        });
        refresh.refresh(&rt).await.unwrap();
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
        LyricsRefresh::new(Limited).refresh(&rt).await.unwrap();
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
}
