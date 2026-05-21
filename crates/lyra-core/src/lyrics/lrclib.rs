use crate::domain::{LyricDocument, LyricSourceKind, TrackRef};
use crate::lyrics::{parser, LyricSource};
use anyhow::{anyhow, Result};
use reqwest::StatusCode;
use serde::Deserialize;

const BASE_URL: &str = "https://lrclib.net/api";
const USER_AGENT: &str = concat!(
    "Lyra/",
    env!("CARGO_PKG_VERSION"),
    " (https://github.com/lyra-app/lyra)",
);

/// Hard duration tolerance for search-tier scoring (seconds). lrclib's own
/// `/api/get` enforces ±2s; we widen slightly for fuzzy search fallback so
/// a re-encode jitter doesn't drop an otherwise-correct match.
const SEARCH_DURATION_TOLERANCE_SEC: i64 = 5;

/// Minimum score a search candidate must reach to be accepted. Tuned so a
/// pure title+artist match without duration agreement is rejected.
const MIN_SEARCH_SCORE: i32 = 50;

pub struct LrclibClient {
    http: reqwest::Client,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
struct LrclibRecord {
    #[serde(default)]
    id: Option<i64>,
    #[serde(default)]
    track_name: Option<String>,
    #[serde(default)]
    artist_name: Option<String>,
    #[serde(default)]
    album_name: Option<String>,
    #[serde(default)]
    duration: Option<f64>,
    #[serde(default)]
    instrumental: bool,
    #[serde(default)]
    synced_lyrics: Option<String>,
    #[serde(default)]
    plain_lyrics: Option<String>,
}

impl LrclibClient {
    pub fn new() -> Self {
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

    /// `/api/get` — exact-signature lookup. Server enforces ±2s duration
    /// window and exact normalized (case/punct-insensitive) track+artist
    /// (and album when supplied). Returns Ok(None) on 404.
    async fn get_signature(
        &self,
        track_name: &str,
        artist_name: &str,
        album_name: Option<&str>,
        duration_sec: Option<u64>,
    ) -> Result<Option<LrclibRecord>> {
        let mut url = format!(
            "{}/get?track_name={}&artist_name={}",
            BASE_URL,
            urlencoding::encode(track_name),
            urlencoding::encode(artist_name),
        );
        if let Some(album) = album_name.filter(|a| !a.trim().is_empty()) {
            url.push_str("&album_name=");
            url.push_str(&urlencoding::encode(album));
        }
        if let Some(dur) = duration_sec {
            url.push_str(&format!("&duration={}", dur));
        }

        let resp = self.http.get(&url).send().await?;
        match resp.status() {
            StatusCode::NOT_FOUND => Ok(None),
            s if s.is_success() => {
                let record: LrclibRecord = resp.json().await?;
                Ok(Some(record))
            }
            s => Err(anyhow!("lrclib get returned status {s}")),
        }
    }

    /// `/api/search` — keyword search, returns up to 20 records.
    async fn search_records(
        &self,
        track_name: &str,
        artist_name: &str,
    ) -> Result<Vec<LrclibRecord>> {
        let url = format!(
            "{}/search?track_name={}&artist_name={}",
            BASE_URL,
            urlencoding::encode(track_name),
            urlencoding::encode(artist_name),
        );

        let resp = self.http.get(&url).send().await?;
        if !resp.status().is_success() {
            return Ok(Vec::new());
        }
        let records: Vec<LrclibRecord> = resp.json().await?;
        Ok(records)
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
        let duration_sec = if track.duration_ms > 0 {
            Some((track.duration_ms + 500) / 1000)
        } else {
            None
        };
        let album = track.album.as_deref();
        let track_variants = extract_variant_tags(&track.title);

        // Tier 1: full signature (track + artist + album + duration).
        // lrclib enforces ±2s and exact normalized album match server-side —
        // the most precise way to disambiguate variants when album differs
        // (e.g. "X (Remix)" lives on a different album than the original).
        if let Some(record) = self
            .get_signature(&track.title, &track.artist, album, duration_sec)
            .await?
        {
            if let Some(doc) = into_document(&track.uri, record) {
                return Ok(Some(doc));
            }
        }

        // Tier 2: drop album. Catches mismatched edition labels
        // (single vs deluxe vs "From the X EP") that still share lyrics.
        if album.is_some() {
            if let Some(record) = self
                .get_signature(&track.title, &track.artist, None, duration_sec)
                .await?
            {
                if let Some(doc) = into_document(&track.uri, record) {
                    return Ok(Some(doc));
                }
            }
        }

        // Tier 3: feature-stripped title. Spotify often appends "(feat. X)"
        // while lrclib stores the base title. Variant markers (Remix/Live/
        // etc.) are NOT stripped — those identify a different recording.
        if let Some(stripped) = strip_feature_annotations(&track.title) {
            if stripped != track.title {
                if let Some(record) = self
                    .get_signature(&stripped, &track.artist, album, duration_sec)
                    .await?
                {
                    if let Some(doc) = into_document(&track.uri, record) {
                        return Ok(Some(doc));
                    }
                }
                if album.is_some() {
                    if let Some(record) = self
                        .get_signature(&stripped, &track.artist, None, duration_sec)
                        .await?
                    {
                        if let Some(doc) = into_document(&track.uri, record) {
                            return Ok(Some(doc));
                        }
                    }
                }
            }
        }

        // Tier 4: search fallback with variant- and duration-aware scoring.
        // The base-name search broadens recall; scoring re-tightens precision.
        let search_title = strip_feature_annotations(&track.title)
            .unwrap_or_else(|| track.title.clone());
        let records = self
            .search_records(&search_title, &track.artist)
            .await
            .unwrap_or_default();

        if let Some(best) = pick_best_record(records, track, &track_variants, duration_sec) {
            if let Some(doc) = into_document(&track.uri, best) {
                return Ok(Some(doc));
            }
        }

        Ok(None)
    }
}

fn into_document(uri: &str, record: LrclibRecord) -> Option<LyricDocument> {
    let synced = record.synced_lyrics.as_deref()?.trim();
    if synced.is_empty() {
        return None;
    }
    parser::parse_lrc(uri, synced, LyricSourceKind::Lrclib).ok()
}

fn pick_best_record(
    records: Vec<LrclibRecord>,
    track: &TrackRef,
    track_variants: &VariantTags,
    duration_sec: Option<u64>,
) -> Option<LrclibRecord> {
    let track_norm_title = normalize_for_compare(&track.title);
    let track_norm_artist = normalize_for_compare(&track.artist);
    let track_norm_album = track
        .album
        .as_deref()
        .map(normalize_for_compare)
        .unwrap_or_default();

    let mut scored: Vec<(i32, LrclibRecord)> = records
        .into_iter()
        .filter(|r| r.synced_lyrics.as_deref().is_some_and(|s| !s.trim().is_empty()))
        .filter_map(|r| {
            let score = score_candidate(
                &r,
                track,
                track_variants,
                duration_sec,
                &track_norm_title,
                &track_norm_artist,
                &track_norm_album,
            )?;
            Some((score, r))
        })
        .collect();

    scored.sort_by(|a, b| b.0.cmp(&a.0));
    scored
        .into_iter()
        .next()
        .filter(|(score, _)| *score >= MIN_SEARCH_SCORE)
        .map(|(_, r)| r)
}

/// Score a search candidate. None = reject (incompatible variant or duration
/// out of tolerance). Higher score wins.
fn score_candidate(
    candidate: &LrclibRecord,
    _track: &TrackRef,
    track_variants: &VariantTags,
    duration_sec: Option<u64>,
    track_norm_title: &str,
    track_norm_artist: &str,
    track_norm_album: &str,
) -> Option<i32> {
    let cand_title = candidate.track_name.as_deref().unwrap_or("");
    let cand_artist = candidate.artist_name.as_deref().unwrap_or("");
    let cand_album = candidate.album_name.as_deref().unwrap_or("");

    let cand_variants = extract_variant_tags(cand_title);

    // Hard reject: lyric-altering variant mismatch. A "Remix" must match a
    // "Remix", a base track must match a base track. Cosmetic variants
    // (remaster) are ignored here.
    if !track_variants.compatible_with(&cand_variants) {
        return None;
    }

    // Hard reject: duration delta beyond tolerance, when we know both.
    let duration_delta = match (duration_sec, candidate.duration) {
        (Some(want), Some(got)) => Some((want as i64 - got.round() as i64).abs()),
        _ => None,
    };
    if let Some(delta) = duration_delta {
        if delta > SEARCH_DURATION_TOLERANCE_SEC {
            return None;
        }
    }

    let cand_norm_title = normalize_for_compare(cand_title);
    let cand_norm_artist = normalize_for_compare(cand_artist);
    let cand_norm_album = normalize_for_compare(cand_album);

    // Artist must align — search may return loosely related artists.
    if !cand_norm_artist.contains(track_norm_artist)
        && !track_norm_artist.contains(&cand_norm_artist)
    {
        return None;
    }

    let mut score: i32 = 0;

    // Title match.
    if cand_norm_title == track_norm_title {
        score += 60;
    } else if cand_norm_title.contains(track_norm_title)
        || track_norm_title.contains(&cand_norm_title)
    {
        score += 35;
    } else {
        // Compare with feature/variant noise removed on both sides.
        let track_base = base_title(track_norm_title);
        let cand_base = base_title(&cand_norm_title);
        if track_base == cand_base {
            score += 25;
        } else {
            score += 5;
        }
    }

    // Artist match strength.
    if cand_norm_artist == track_norm_artist {
        score += 25;
    } else {
        score += 10;
    }

    // Album match — strong signal for variant disambiguation.
    if !track_norm_album.is_empty() && !cand_norm_album.is_empty() {
        if cand_norm_album == track_norm_album {
            score += 20;
        } else if cand_norm_album.contains(track_norm_album)
            || track_norm_album.contains(&cand_norm_album)
        {
            score += 10;
        }
    }

    // Duration agreement.
    match duration_delta {
        Some(0) => score += 25,
        Some(1) => score += 20,
        Some(2) => score += 15,
        Some(3) => score += 8,
        Some(4) => score += 3,
        Some(_) => {}
        None => {}
    }

    // Variant exact-match bonus when track has variants — guards against a
    // base "Song" being picked when "Song (Remix)" exists with same artist.
    if !track_variants.lyric_altering.is_empty()
        && track_variants.lyric_altering == cand_variants.lyric_altering
    {
        score += 15;
    }

    Some(score)
}

// ─── Title normalization ────────────────────────────────────────────────────

fn normalize_for_compare(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut prev_space = true;
    for ch in s.chars() {
        let c = ch.to_ascii_lowercase();
        if c.is_alphanumeric() {
            out.push(c);
            prev_space = false;
        } else if c.is_whitespace() {
            if !prev_space {
                out.push(' ');
                prev_space = true;
            }
        }
        // punctuation dropped
    }
    out.trim().to_string()
}

/// Strip the trailing parenthetical/dash variant suffix to produce a "base"
/// title for fuzzy comparison only. Used during scoring, NOT during lookup
/// — we never want to look up a remix as if it were the base track.
fn base_title(normalized: &str) -> String {
    let lower = normalized;
    let cut_markers = [
        " remix", " live", " acoustic", " sped up", " slowed", " reverb",
        " demo", " radio edit", " extended", " remaster", " remastered",
        " piano", " orchestral", " karaoke", " instrumental", " cover",
        " version",
    ];
    let mut shortest = lower.to_string();
    for marker in cut_markers {
        if let Some(idx) = lower.find(marker) {
            let candidate = lower[..idx].trim().to_string();
            if !candidate.is_empty() && candidate.len() < shortest.len() {
                shortest = candidate;
            }
        }
    }
    shortest
}

/// Remove " (feat. X)", " [ft. Y]", " feat. Z" suffixes. Returns Some(new)
/// when a strip happened, None otherwise.
fn strip_feature_annotations(title: &str) -> Option<String> {
    let trimmed = title.trim();
    let without_inline = strip_inline_feature_suffix(trimmed);
    let without_group = strip_trailing_feature_group(without_inline).trim();
    if without_group.is_empty() || without_group == trimmed {
        None
    } else {
        Some(without_group.to_string())
    }
}

fn strip_inline_feature_suffix(title: &str) -> &str {
    let lower = title.to_ascii_lowercase();
    for marker in [" feat. ", " ft. ", " featuring ", " feat ", " ft "] {
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
    ["feat.", "feat ", "ft.", "ft ", "featuring", "with "]
        .iter()
        .any(|marker| group.starts_with(marker))
}

// ─── Variant detection ──────────────────────────────────────────────────────

#[derive(Debug, Default, Clone, PartialEq, Eq)]
struct VariantTags {
    /// Variants that change the lyrics or recording in a way that demands a
    /// matching lyric record (Remix, Live, Acoustic, Sped Up, Cover, etc.).
    lyric_altering: Vec<VariantTag>,
    /// Variants that don't change lyrics (Remaster, Mono, Stereo).
    cosmetic: Vec<VariantTag>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum VariantTag {
    Remix,
    Live,
    Acoustic,
    SpedUp,
    Slowed,
    Reverb,
    Demo,
    RadioEdit,
    Extended,
    Piano,
    Orchestral,
    Karaoke,
    Instrumental,
    Cover,
    Remaster,
}

impl VariantTag {
    fn is_lyric_altering(self) -> bool {
        !matches!(self, VariantTag::Remaster)
    }
}

impl VariantTags {
    fn from_iter(tags: impl IntoIterator<Item = VariantTag>) -> Self {
        let mut out = VariantTags::default();
        for t in tags {
            if t.is_lyric_altering() {
                if !out.lyric_altering.contains(&t) {
                    out.lyric_altering.push(t);
                }
            } else if !out.cosmetic.contains(&t) {
                out.cosmetic.push(t);
            }
        }
        out.lyric_altering.sort();
        out.cosmetic.sort();
        out
    }

    /// A candidate is compatible if its lyric-altering tags match exactly.
    fn compatible_with(&self, other: &VariantTags) -> bool {
        self.lyric_altering == other.lyric_altering
    }
}

fn extract_variant_tags(title: &str) -> VariantTags {
    let lower = title.to_ascii_lowercase();
    let mut found: Vec<VariantTag> = Vec::new();
    for (needle, tag) in VARIANT_KEYWORDS {
        if title_contains_variant_keyword(&lower, needle) {
            found.push(*tag);
        }
    }
    VariantTags::from_iter(found)
}

/// Match a variant keyword as a "decorator" — inside parens/brackets, after
/// " - ", or as a clearly demarcated trailing token. Avoids false positives
/// like a song literally named "Live Forever".
fn title_contains_variant_keyword(lower_title: &str, needle: &str) -> bool {
    // Inside a paren/bracket group.
    for open in ['(', '['] {
        let close = if open == '(' { ')' } else { ']' };
        let mut search: &str = lower_title;
        while let Some(o) = search.find(open) {
            let rest = &search[o + 1..];
            if let Some(c) = rest.find(close) {
                let group = &rest[..c];
                if group_matches_variant(group, needle) {
                    return true;
                }
                search = &rest[c + 1..];
            } else {
                break;
            }
        }
    }
    // After a " - " dash separator (common Spotify convention,
    // e.g. "Anti-Hero - Sped Up Version").
    if let Some(idx) = lower_title.rfind(" - ") {
        let tail = &lower_title[idx + 3..];
        if group_matches_variant(tail, needle) {
            return true;
        }
    }
    false
}

fn group_matches_variant(group: &str, needle: &str) -> bool {
    let g = group.trim();
    // Whole-word containment: needle surrounded by start, end, or non-alnum.
    let Some(idx) = g.find(needle) else {
        return false;
    };
    let before_ok = idx == 0
        || !g.as_bytes()[idx - 1].is_ascii_alphanumeric();
    let after_idx = idx + needle.len();
    let after_ok = after_idx == g.len()
        || !g.as_bytes()[after_idx].is_ascii_alphanumeric();
    before_ok && after_ok
}

const VARIANT_KEYWORDS: &[(&str, VariantTag)] = &[
    ("remix", VariantTag::Remix),
    ("live", VariantTag::Live),
    ("acoustic", VariantTag::Acoustic),
    ("sped up", VariantTag::SpedUp),
    ("sped-up", VariantTag::SpedUp),
    ("nightcore", VariantTag::SpedUp),
    ("slowed", VariantTag::Slowed),
    ("reverb", VariantTag::Reverb),
    ("demo", VariantTag::Demo),
    ("radio edit", VariantTag::RadioEdit),
    ("radio version", VariantTag::RadioEdit),
    ("extended", VariantTag::Extended),
    ("piano", VariantTag::Piano),
    ("orchestral", VariantTag::Orchestral),
    ("karaoke", VariantTag::Karaoke),
    ("instrumental", VariantTag::Instrumental),
    ("cover", VariantTag::Cover),
    ("remaster", VariantTag::Remaster),
    ("remastered", VariantTag::Remaster),
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_parenthesized_feature_suffix() {
        assert_eq!(
            strip_feature_annotations("Paris, Texas (feat. SYML)"),
            Some("Paris, Texas".to_string())
        );
    }

    #[test]
    fn strips_inline_feature_suffix() {
        assert_eq!(
            strip_feature_annotations("Paris, Texas feat. SYML"),
            Some("Paris, Texas".to_string())
        );
    }

    #[test]
    fn keeps_non_feature_parenthetical_titles() {
        assert_eq!(strip_feature_annotations("Video Games (Remastered)"), None);
    }

    #[test]
    fn does_not_strip_remix_as_feature() {
        // Critical: a remix is not a feature suffix. The looked-up title must
        // stay "Song (Remix)" so lrclib resolves the remix's lyric record.
        assert_eq!(strip_feature_annotations("Song (Remix)"), None);
    }

    #[test]
    fn detects_remix_variant() {
        let tags = extract_variant_tags("Levitating (DaBaby Remix)");
        assert!(tags.lyric_altering.contains(&VariantTag::Remix));
    }

    #[test]
    fn detects_dash_separated_variant() {
        let tags = extract_variant_tags("Anti-Hero - Sped Up Version");
        assert!(tags.lyric_altering.contains(&VariantTag::SpedUp));
    }

    #[test]
    fn detects_live_variant_in_brackets() {
        let tags = extract_variant_tags("Wonderwall [Live at Wembley]");
        assert!(tags.lyric_altering.contains(&VariantTag::Live));
    }

    #[test]
    fn does_not_falsely_detect_live_in_song_title() {
        // "Live Forever" — "live" appears as part of the bare title, not as a
        // decorator. Must NOT be tagged as a Live variant.
        let tags = extract_variant_tags("Live Forever");
        assert!(tags.lyric_altering.is_empty());
    }

    #[test]
    fn remaster_is_cosmetic_not_lyric_altering() {
        let tags = extract_variant_tags("Video Games (Remastered)");
        assert!(tags.lyric_altering.is_empty());
        assert!(tags.cosmetic.contains(&VariantTag::Remaster));
    }

    #[test]
    fn base_and_remix_are_incompatible() {
        let base = extract_variant_tags("Levitating");
        let remix = extract_variant_tags("Levitating (DaBaby Remix)");
        assert!(!base.compatible_with(&remix));
        assert!(!remix.compatible_with(&base));
    }

    #[test]
    fn remix_and_remix_are_compatible() {
        let a = extract_variant_tags("Levitating (DaBaby Remix)");
        let b = extract_variant_tags("Levitating - Remix");
        assert!(a.compatible_with(&b));
    }

    #[test]
    fn base_and_remaster_are_compatible() {
        // Remaster doesn't change lyrics — picking a remaster record for a
        // non-remaster track (or vice versa) is fine.
        let base = extract_variant_tags("Video Games");
        let remaster = extract_variant_tags("Video Games (Remastered)");
        assert!(base.compatible_with(&remaster));
    }

    #[test]
    fn normalize_strips_punctuation_and_case() {
        assert_eq!(
            normalize_for_compare("Paris, Texas!"),
            "paris texas".to_string()
        );
    }
}
