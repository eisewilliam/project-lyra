use crate::domain::{LyricDocument, LyricSourceKind, TrackRef};
use crate::lyrics::{parser, LyricSource};
use anyhow::{anyhow, Result};
use serde::Deserialize;

const BASE_URL: &str = "https://lrclib.net/api";

pub struct LrclibClient {
    http: reqwest::Client,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LrclibResponse {
    synced_lyrics: Option<String>,
}

impl LrclibClient {
    pub fn new() -> Self {
        Self { http: reqwest::Client::new() }
    }
}

impl Default for LrclibClient {
    fn default() -> Self {
        Self::new()
    }
}

impl LyricSource for LrclibClient {
    fn name(&self) -> &str {
        "lrclib"
    }

    async fn fetch(&self, track: &TrackRef) -> Result<Option<LyricDocument>> {
        let url = format!(
            "{}/search?track_name={}&artist_name={}",
            BASE_URL,
            urlencoding::encode(&track.title),
            urlencoding::encode(&track.artist),
        );

        let resp = self
            .http
            .get(&url)
            .header("User-Agent", "Lyra/0.1 (https://github.com/lyra-app/lyra)")
            .send()
            .await?;

        if !resp.status().is_success() {
            return Ok(None);
        }

        let results: Vec<LrclibResponse> = resp.json().await?;
        let Some(synced) = results.into_iter().find_map(|r| r.synced_lyrics) else {
            return Ok(None);
        };

        let doc = parser::parse_lrc(&track.uri, &synced, LyricSourceKind::Lrclib)
            .map_err(|e| anyhow!("parse error: {e}"))?;

        Ok(Some(doc))
    }
}
