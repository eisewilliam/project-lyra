use super::{import::MAX_FILE_BYTES, parser, refresh::LyricsRefresh, LyricSource};
use crate::{
    domain::{LyricSourceKind, LyricsOrigin, TrackRef},
    runtime::LyraRuntime,
};
use ring::digest::{Context, SHA256};
use serde::{Deserialize, Serialize};
use std::{
    fmt::Write,
    sync::Mutex,
    time::{Duration, Instant},
};
use tokio::sync::Semaphore;

#[derive(Deserialize)]
pub struct TimedLine {
    pub start_ms: u64,
    pub text: String,
}

const TRACK_CHANGED: &str = "The playing track changed.";
const CONTENT_CHANGED: &str = "The saved lyrics changed. Open the saved lyrics again.";
static PUBLISHING: Semaphore = Semaphore::const_new(1);

fn current(runtime: &LyraRuntime, key: &str) -> Result<TrackRef, String> {
    runtime
        .current_track()
        .filter(|t| t.uri == key)
        .ok_or_else(|| TRACK_CHANGED.into())
}

impl<S: LyricSource> LyricsRefresh<S> {
    pub fn save_timed(
        &self,
        runtime: &Mutex<LyraRuntime>,
        key: &str,
        lines: &[TimedLine],
    ) -> Result<(), String> {
        let track = current(&*runtime.lock().map_err(|_| TRACK_CHANGED)?, key)?;
        let mut raw = String::new();
        let mut previous = None;
        for line in lines {
            let ms = line.start_ms / 10 * 10;
            let text = line.text.trim();
            if text.is_empty()
                || text.contains(['\n', '\r', '\0'])
                || previous.is_some_and(|p| p >= ms)
                || (track.duration_ms > 0 && ms > track.duration_ms)
            {
                return Err("Each line needs a later time within the track.".into());
            }
            if raw.len().saturating_add(text.len() + 32) > MAX_FILE_BYTES as usize {
                return Err("The lyrics are too long.".into());
            }
            writeln!(
                raw,
                "[{:02}:{:02}.{:02}] {}",
                ms / 60000,
                ms / 1000 % 60,
                ms / 10 % 100,
                text
            )
            .unwrap();
            previous = Some(ms);
        }
        let doc = parser::parse_lrc(key, &raw, LyricSourceKind::ManualOverride)
            .map_err(|_| "Add at least one timed line.")?;
        if doc.lines.len() != lines.len()
            || doc.lines.iter().zip(lines).any(|(parsed, original)| {
                parsed.start_ms != original.start_ms / 10 * 10
                    || parsed.text != original.text.trim()
            })
        {
            return Err("Remove embedded word timestamps before saving.".into());
        }
        self.save_user_lyrics(runtime, doc, LyricsOrigin::Timed)
            .map_err(|e| e.to_string())
    }
}

#[derive(Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct Publication {
    track_name: String,
    artist_name: String,
    album_name: String,
    duration: f64,
    plain_lyrics: String,
    synced_lyrics: String,
}

fn publication(runtime: &Mutex<LyraRuntime>, key: &str) -> Result<Publication, String> {
    let rt = runtime.lock().map_err(|_| TRACK_CHANGED)?;
    let track = current(&rt, key)?;
    let doc = rt
        .timed_override()
        .filter(|doc| doc.track_key == key)
        .ok_or(CONTENT_CHANGED)?;
    let album = track.album.unwrap_or_default();
    if track.title.trim().is_empty()
        || track.artist.trim().is_empty()
        || album.trim().is_empty()
        || track.duration_ms == 0
    {
        return Err("LRCLIB needs a title, artist, album and track length.".into());
    }
    Ok(Publication {
        track_name: track.title,
        artist_name: track.artist,
        album_name: album,
        duration: track.duration_ms as f64 / 1000.0,
        plain_lyrics: doc
            .lines
            .iter()
            .map(|l| l.text.as_str())
            .collect::<Vec<_>>()
            .join("\n"),
        synced_lyrics: doc.raw_lrc.clone(),
    })
}

#[derive(Deserialize)]
struct Challenge {
    prefix: String,
    target: String,
}

fn token(challenge: Challenge, deadline: Instant) -> Result<String, String> {
    let mut target = [0u8; 32];
    hex::decode_to_slice(challenge.target, &mut target).map_err(|_| "Invalid LRCLIB target.")?;
    if challenge.prefix.is_empty()
        || challenge.prefix.len() > 128
        || !challenge.prefix.bytes().all(|b| b.is_ascii_alphanumeric())
    {
        return Err("Invalid LRCLIB prefix.".into());
    }
    let mut prefix = Context::new(&SHA256);
    prefix.update(challenge.prefix.as_bytes());
    let mut decimal = itoa::Buffer::new();
    for nonce in 0u64.. {
        if nonce % 4096 == 0 && Instant::now() >= deadline {
            break;
        }
        let mut digest = prefix.clone();
        digest.update(decimal.format(nonce).as_bytes());
        if digest.finish().as_ref() <= target.as_slice() {
            return Ok(format!("{}:{nonce}", challenge.prefix));
        }
    }
    Err("The LRCLIB challenge timed out. Try again.".into())
}

impl LyricsRefresh {
    pub async fn publish_timed(
        &self,
        runtime: &Mutex<LyraRuntime>,
        key: &str,
    ) -> Result<(), String> {
        let _permit = PUBLISHING
            .try_acquire()
            .map_err(|_| "A publication is already in progress.")?;
        let payload = publication(runtime, key)?;
        let client = &self.source;
        client
            .wait_turn()
            .await
            .map_err(|_| "LRCLIB is busy. Try again later.")?;
        let response = client
            .http
            .post(format!("{}/request-challenge", client.base_url))
            .send()
            .await
            .map_err(|_| "Could not reach LRCLIB. Try again.")?;
        client.record_publish_response(&response);
        if !response.status().is_success() {
            return Err(format!(
                "LRCLIB declined the challenge (HTTP {}). Try again later.",
                response.status().as_u16()
            ));
        }
        let challenge = response
            .json()
            .await
            .map_err(|_| "Invalid LRCLIB challenge.")?;
        let token = tokio::task::spawn_blocking(move || {
            token(challenge, Instant::now() + Duration::from_secs(60))
        })
        .await
        .map_err(|_| "The LRCLIB challenge stopped.")??;
        client
            .wait_turn()
            .await
            .map_err(|_| "LRCLIB is busy. Try again later.")?;
        if publication(runtime, key)? != payload {
            return Err(CONTENT_CHANGED.into());
        }
        let response = client
            .http
            .post(format!("{}/publish", client.base_url))
            .header("X-Publish-Token", token)
            .json(&payload)
            .send()
            .await
            .map_err(|_| "LRCLIB did not confirm publication. Check LRCLIB before trying again.")?;
        client.record_publish_response(&response);
        if response.status().is_server_error() {
            return Err(format!(
                "LRCLIB did not confirm publication (HTTP {}). Check LRCLIB before trying again.",
                response.status().as_u16()
            ));
        }
        if response.status() != reqwest::StatusCode::CREATED {
            return Err(format!(
                "LRCLIB declined publication (HTTP {}).",
                response.status().as_u16()
            ));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{PlaybackSnapshot, PlaybackState};

    #[test]
    fn challenge_uses_decimal_nonce_and_inclusive_digest_target() {
        let target = hex::encode(ring::digest::digest(&SHA256, b"abc0").as_ref());
        let deadline = Instant::now() + Duration::from_secs(1);
        assert_eq!(
            token(
                Challenge {
                    prefix: "abc".into(),
                    target
                },
                deadline
            )
            .unwrap(),
            "abc:0"
        );
        assert!(token(
            Challenge {
                prefix: "abc".into(),
                target: "00".repeat(32)
            },
            Instant::now()
        )
        .is_err());
        assert!(token(
            Challenge {
                prefix: "abc".into(),
                target: "ff".into()
            },
            deadline
        )
        .is_err());
    }

    #[tokio::test]
    async fn explicit_retry_gets_a_fresh_token_and_sends_the_saved_payload() {
        use std::io::{BufRead, BufReader, Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let base_url = format!("http://{}", listener.local_addr().unwrap());
        let peer = std::thread::spawn(move || {
            let mut requests = Vec::new();
            for (status, answer) in [
                (
                    200,
                    format!(r#"{{"prefix":"first","target":"{}"}}"#, "FF".repeat(32)),
                ),
                (400, String::new()),
                (
                    200,
                    format!(r#"{{"prefix":"next","target":"{}"}}"#, "FF".repeat(32)),
                ),
                (201, String::new()),
            ] {
                let (mut stream, _) = listener.accept().unwrap();
                let mut reader = BufReader::new(&stream);
                let mut headers = String::new();
                while !headers.ends_with("\r\n\r\n") {
                    assert!(reader.read_line(&mut headers).unwrap() > 0);
                }
                let headers = headers.to_ascii_lowercase();
                let len = headers
                    .lines()
                    .find_map(|s| s.strip_prefix("content-length: "))
                    .map_or(0, |n| n.parse().unwrap());
                let mut body = vec![0u8; len];
                reader.read_exact(&mut body).unwrap();
                requests.push((headers, body));
                write!(stream, "HTTP/1.1 {status} Test\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{answer}",answer.len()).unwrap();
            }
            requests
        });
        let mut client = super::super::lrclib::LrclibClient::new();
        client.base_url = base_url;
        let refresh = LyricsRefresh::new(client);
        let dir = std::env::temp_dir().join(format!("lyra-maker-http-{}", std::process::id()));
        let mut runtime = LyraRuntime::new_in(dir.clone());
        let key = "test";
        runtime.set_playback_snapshot(PlaybackSnapshot {
            track: Some(TrackRef {
                album: Some("Album".into()),
                ..TrackRef::fixture(key)
            }),
            ..PlaybackSnapshot::stopped(0)
        });
        runtime.tick();
        let rt = Mutex::new(runtime);
        refresh
            .save_timed(
                &rt,
                key,
                &[TimedLine {
                    start_ms: 530,
                    text: "Line".into(),
                }],
            )
            .unwrap();
        assert!(refresh
            .publish_timed(&rt, key)
            .await
            .unwrap_err()
            .contains("400"));
        refresh.publish_timed(&rt, key).await.unwrap();
        let requests = peer.join().unwrap();
        for (pair, token) in requests.chunks_exact(2).zip(["first:0", "next:0"]) {
            assert!(pair[0].0.starts_with("post /request-challenge "));
            assert!(pair[0].1.is_empty());
            assert!(pair[1].0.starts_with("post /publish "));
            assert!(pair[1].0.contains(&format!("x-publish-token: {token}\r\n")));
            assert!(pair[1].0.contains("user-agent: lyra/"));
            assert_eq!(
                serde_json::from_slice::<serde_json::Value>(&pair[1].1).unwrap(),
                serde_json::json!({
                    "trackName":"title","artistName":"artist","albumName":"Album","duration":180.0,
                    "plainLyrics":"Line","syncedLyrics":"[00:00.53] Line\n"
                })
            );
        }
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn saved_timings_round_trip_and_publication_uses_the_authored_recording() {
        let key = "maker-test";
        let dir = std::env::temp_dir().join(format!("lyra-maker-{}", std::process::id()));
        let rt = Mutex::new(LyraRuntime::new_in(dir.clone()));
        let refresh = LyricsRefresh::default();
        let playback = PlaybackSnapshot {
            track: Some(TrackRef {
                album: Some("Album".into()),
                ..TrackRef::fixture(key)
            }),
            state: PlaybackState::Playing,
            position_ms: Some(100),
            ..PlaybackSnapshot::stopped(0)
        };
        rt.lock().unwrap().set_playback_snapshot(playback.clone());
        rt.lock().unwrap().tick();
        assert!(publication(&rt, key).is_err());
        let mut lines = [
            TimedLine {
                start_ms: 109,
                text: "[Chorus]".into(),
            },
            TimedLine {
                start_ms: 109,
                text: "[00:00.00] literal".into(),
            },
        ];
        assert!(refresh.save_timed(&rt, key, &lines).is_err());
        lines[1].start_ms = 1234;
        assert!(refresh.save_timed(&rt, "other", &lines).is_err());
        refresh.save_timed(&rt, key, &lines).unwrap();
        let mut reopened = LyraRuntime::new_in(dir.clone());
        reopened.set_playback_snapshot(playback);
        reopened.tick();
        let reopened = Mutex::new(reopened);
        let payload = publication(&reopened, key).unwrap();
        assert_eq!(payload.plain_lyrics, "[Chorus]\n[00:00.00] literal");
        assert_eq!(
            payload.synced_lyrics,
            "[00:00.10] [Chorus]\n[00:01.23] [00:00.00] literal\n"
        );
        assert_eq!(serde_json::to_value(payload).unwrap()["duration"], 180.0);
        assert!(publication(&reopened, "other").is_err());
        refresh.reset_choice(&reopened).unwrap();
        assert!(publication(&reopened, key).is_err());
        let _ = std::fs::remove_dir_all(dir);
    }
}
