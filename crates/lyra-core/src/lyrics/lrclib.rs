use crate::domain::{LyricDocument, LyricSourceKind, TrackRef};
use crate::lyrics::{parser, LyricSource};
use anyhow::{anyhow, Result};
use serde::Deserialize;
use std::borrow::Cow;

const BASE_URL: &str = "https://lrclib.net/api";
const USER_AGENT: &str = concat!(
    "Lyra/",
    env!("CARGO_PKG_VERSION"),
    " (https://github.com/lyra-app/lyra)",
);

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
        // Tune the shared HTTP client for low-energy idle: keep a small pool
        // of idle connections alive so successive lyric fetches reuse the
        // same TCP/TLS connection (avoids handshake), gzip lets the server
        // compress JSON payloads, explicit timeouts stop hung sockets from
        // pinning a tokio task forever.
        let http = reqwest::Client::builder()
            .pool_max_idle_per_host(2)
            .pool_idle_timeout(std::time::Duration::from_secs(90))
            .gzip(true)
            .timeout(std::time::Duration::from_secs(30))
            .connect_timeout(std::time::Duration::from_secs(10))
            .user_agent(USER_AGENT)
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());
        Self { http }
    }

    async fn search(&self, track_name: &str, artist_name: &str) -> Result<Option<String>> {
        let url = format!(
            "{}/search?track_name={}&artist_name={}",
            BASE_URL,
            urlencoding::encode(track_name),
            urlencoding::encode(artist_name),
        );

        let resp = self
            .http
            .get(&url)
            .header("User-Agent", USER_AGENT)
            .send()
            .await?;

        if !resp.status().is_success() {
            return Ok(None);
        }

        let results: Vec<LrclibResponse> = resp.json().await?;
        Ok(results.into_iter().find_map(|r| r.synced_lyrics))
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
        let mut last_error = None;

        for title in candidate_titles(&track.title) {
            match self.search(title.as_ref(), &track.artist).await {
                Ok(Some(synced)) => {
                    let doc = parser::parse_lrc(&track.uri, &synced, LyricSourceKind::Lrclib)
                        .map_err(|e| anyhow!("parse error: {e}"))?;
                    return Ok(Some(doc));
                }
                Ok(None) => continue,
                Err(err) => {
                    last_error = Some(err);
                    continue;
                }
            }
        }

        if let Some(err) = last_error {
            return Err(err);
        }

        Ok(None)
    }
}

fn candidate_titles(title: &str) -> Vec<Cow<'_, str>> {
    let mut titles = Vec::with_capacity(2);
    if let Some(normalized) = normalized_track_title(title) {
        titles.push(Cow::Owned(normalized));
    }
    titles.push(Cow::Borrowed(title));
    titles
}

fn normalized_track_title(title: &str) -> Option<String> {
    let trimmed = title.trim();
    let without_inline_feature = strip_inline_feature_suffix(trimmed);
    let normalized = strip_trailing_feature_group(without_inline_feature).trim();

    if normalized.is_empty() || normalized == trimmed {
        None
    } else {
        Some(normalized.to_string())
    }
}

fn strip_inline_feature_suffix(title: &str) -> &str {
    let lower = title.to_ascii_lowercase();
    for marker in [" feat. ", " ft. ", " featuring "] {
        if let Some(index) = lower.find(marker) {
            return title[..index].trim_end();
        }
    }
    title
}

fn strip_trailing_feature_group(title: &str) -> &str {
    let trimmed = title.trim_end();
    let Some((open, close)) = trailing_group_bounds(trimmed) else {
        return trimmed;
    };

    let group = &trimmed[open + 1..close];
    let group_lower = group.trim().to_ascii_lowercase();
    if !is_feature_annotation(&group_lower) {
        return trimmed;
    }

    trimmed[..open].trim_end()
}

fn trailing_group_bounds(title: &str) -> Option<(usize, usize)> {
    let close = title.len().checked_sub(1)?;
    let closing = title.as_bytes()[close];
    let opening = match closing {
        b')' => b'(',
        b']' => b'[',
        _ => return None,
    };

    let open = title[..close].rfind(char::from(opening))?;
    Some((open, close))
}

fn is_feature_annotation(group: &str) -> bool {
    ["feat", "ft.", "ft ", "featuring", "with "]
        .iter()
        .any(|marker| group.starts_with(marker))
}

#[cfg(test)]
mod tests {
    use super::{candidate_titles, normalized_track_title};

    #[test]
    fn strips_parenthesized_feature_suffix() {
        assert_eq!(
            normalized_track_title("Paris, Texas (feat. SYML)"),
            Some("Paris, Texas".to_string())
        );
    }

    #[test]
    fn strips_inline_feature_suffix() {
        assert_eq!(
            normalized_track_title("Paris, Texas feat. SYML"),
            Some("Paris, Texas".to_string())
        );
    }

    #[test]
    fn keeps_non_feature_parenthetical_titles() {
        assert_eq!(normalized_track_title("Video Games (Remastered)"), None);
    }

    #[test]
    fn tries_normalized_title_before_exact_title() {
        let titles = candidate_titles("Paris, Texas (feat. SYML)")
            .into_iter()
            .map(|title| title.into_owned())
            .collect::<Vec<_>>();

        assert_eq!(titles, vec!["Paris, Texas".to_string(), "Paris, Texas (feat. SYML)".to_string()]);
    }

    #[test]
    fn uses_exact_title_when_no_normalization_needed() {
        let titles = candidate_titles("Mariners Apartment Complex")
            .into_iter()
            .map(|title| title.into_owned())
            .collect::<Vec<_>>();

        assert_eq!(titles, vec!["Mariners Apartment Complex".to_string()]);
    }
}
