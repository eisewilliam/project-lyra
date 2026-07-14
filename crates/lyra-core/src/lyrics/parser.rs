use crate::domain::{LyricDocument, LyricLine, LyricSourceKind, LyricWord};
use anyhow::{anyhow, Result};

/// Parse an LRC string into a `LyricDocument`. Supports both plain LRC
/// (line-level timestamps only) and enhanced LRC with inline `<mm:ss.xx>`
/// word-level markers.
pub fn parse_lrc(track_key: &str, raw: &str, source: LyricSourceKind) -> Result<LyricDocument> {
    let mut lines: Vec<LyricLine> = Vec::new();

    for line in raw.lines() {
        let line = line.trim();
        if line.is_empty() || !line.starts_with('[') {
            continue;
        }

        // Skip metadata tags like [ar:...], [ti:...], [by:...], [offset:...]
        let tag_end = line.find(']').unwrap_or(0);
        let tag = &line[1..tag_end];
        if tag.contains(':')
            && !tag
                .chars()
                .next()
                .map(|c| c.is_ascii_digit())
                .unwrap_or(false)
        {
            continue;
        }

        // May have multiple timestamps on one line: [00:01.00][00:02.00]text
        let mut remaining = line;
        let mut timestamps: Vec<u64> = Vec::new();

        while remaining.starts_with('[') {
            let end = remaining
                .find(']')
                .ok_or_else(|| anyhow!("unclosed bracket"))?;
            let ts_str = &remaining[1..end];
            if let Ok(ms) = parse_timestamp(ts_str) {
                timestamps.push(ms);
            }
            remaining = &remaining[end + 1..];
        }

        let raw_text = remaining.trim();
        let (plain_text, words_raw) = extract_words(raw_text);

        for ts in timestamps {
            lines.push(LyricLine {
                start_ms: ts,
                end_ms: None,
                text: plain_text.clone(),
                words: words_raw.clone(),
            });
        }
    }

    if lines.is_empty() {
        return Err(anyhow!("no timed lines found"));
    }

    lines.sort_by_key(|l| l.start_ms);

    // Derive end_ms from the next line's start_ms.
    let len = lines.len();
    for i in 0..len {
        if i + 1 < len {
            lines[i].end_ms = Some(lines[i + 1].start_ms);
        }
    }

    // Patch word end_ms now that line end_ms is known.
    for line in &mut lines {
        if let Some(ws) = line.words.as_mut() {
            let fallback_end = line.end_ms.unwrap_or_else(|| {
                ws.last()
                    .map(|w| w.end_ms.max(w.start_ms + 500))
                    .unwrap_or(line.start_ms + 5000)
            });
            let count = ws.len();
            for i in 0..count {
                if i + 1 < count {
                    if ws[i].end_ms == 0 || ws[i].end_ms < ws[i].start_ms {
                        ws[i].end_ms = ws[i + 1].start_ms;
                    }
                } else if ws[i].end_ms == 0 || ws[i].end_ms < ws[i].start_ms {
                    // Last word: cap at ~2× typical singing duration so it
                    // doesn't stretch through trailing silence before the
                    // next line.
                    let chars = ws[i].text.chars().filter(|c| !c.is_whitespace()).count() as u64;
                    let typical_ms = (chars * 1000 / 8).max(300);
                    let max_ms = typical_ms * 2;
                    ws[i].end_ms = (ws[i].start_ms + max_ms)
                        .min(fallback_end)
                        .max(ws[i].start_ms + 200);
                }
            }
        }
    }

    Ok(LyricDocument {
        track_key: track_key.to_string(),
        source,
        lines,
        raw_lrc: raw.to_string(),
    })
}

/// Return (plain_text, optional_word_timings). When inline `<ts>` markers are
/// absent, returns the trimmed text and `None`. When present, returns the text
/// with markers stripped and a list of `LyricWord` (end_ms is filled later by
/// the parent function once line bounds are known).
fn extract_words(text: &str) -> (String, Option<Vec<LyricWord>>) {
    if !text.contains('<') {
        return (text.to_string(), None);
    }

    let mut plain = String::with_capacity(text.len());
    let mut words: Vec<LyricWord> = Vec::new();
    let mut rest = text;

    // Any text BEFORE the first marker is preserved in plain text but has no
    // timing (rare — most enhanced LRC starts with a marker).
    if let Some(idx) = rest.find('<') {
        let prefix = &rest[..idx];
        plain.push_str(prefix);
        rest = &rest[idx..];
    }

    while let Some(stripped) = rest.strip_prefix('<') {
        let Some(close) = stripped.find('>') else {
            break;
        };
        let ts_str = &stripped[..close];
        let Ok(start_ms) = parse_timestamp(ts_str) else {
            // Malformed marker — keep literal text and bail.
            plain.push_str(rest);
            return (plain, if words.is_empty() { None } else { Some(words) });
        };

        let after = &stripped[close + 1..];
        let next = after.find('<').unwrap_or(after.len());
        let word_text = &after[..next];

        plain.push_str(word_text);
        if !word_text.is_empty() {
            words.push(LyricWord {
                start_ms,
                end_ms: 0,
                text: word_text.to_string(),
            });
        }

        rest = &after[next..];
    }

    let plain = plain.trim().to_string();
    if words.is_empty() {
        (plain, None)
    } else {
        (plain, Some(words))
    }
}

fn parse_timestamp(s: &str) -> Result<u64> {
    // Formats: mm:ss.xx  mm:ss.xxx  mm:ss
    let (mins, rest) = s.split_once(':').ok_or_else(|| anyhow!("bad ts: {s}"))?;
    let (secs, centis) = if let Some((s, c)) = rest.split_once('.') {
        (s, c)
    } else {
        (rest, "0")
    };

    let m: u64 = mins.parse()?;
    let s: u64 = secs.parse()?;
    // Normalise centiseconds to milliseconds regardless of digit count
    let ms: u64 = match centis.len() {
        1 => centis.parse::<u64>()? * 100,
        2 => centis.parse::<u64>()? * 10,
        3 => centis.parse::<u64>()?,
        _ => centis[..3].parse::<u64>()?,
    };

    Ok(m * 60_000 + s * 1_000 + ms)
}

/// Helper to convert plain (non-timestamped) lyrics into a basic LRC-formatted string
/// with synthetic timestamps, so they can be processed and rendered by the engine.
pub fn plain_lyrics_to_lrc(plain: &str) -> String {
    let mut lrc = String::new();
    for (i, line) in plain.lines().enumerate() {
        let seconds = i * 4;
        let minutes = seconds / 60;
        let remaining_seconds = seconds % 60;
        lrc.push_str(&format!("[{:02}:{:02}.00]{}\n", minutes, remaining_seconds, line));
    }
    lrc
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_basic_lrc() {
        let raw = "[00:01.00]Hello\n[00:03.50]World\n";
        let doc = parse_lrc("test", raw, LyricSourceKind::Lrclib).unwrap();
        assert_eq!(doc.lines.len(), 2);
        assert_eq!(doc.lines[0].start_ms, 1000);
        assert_eq!(doc.lines[0].text, "Hello");
        assert_eq!(doc.lines[0].end_ms, Some(3500));
        assert_eq!(doc.lines[1].start_ms, 3500);
    }

    #[test]
    fn skips_metadata_tags() {
        let raw = "[ar:Artist]\n[ti:Title]\n[00:01.00]Line one\n";
        let doc = parse_lrc("test", raw, LyricSourceKind::Lrclib).unwrap();
        assert_eq!(doc.lines.len(), 1);
    }

    #[test]
    fn parse_timestamp_formats() {
        assert_eq!(parse_timestamp("00:01.00").unwrap(), 1000);
        assert_eq!(parse_timestamp("01:30.50").unwrap(), 90500);
        assert_eq!(parse_timestamp("00:00.500").unwrap(), 500);
    }

    #[test]
    fn parses_enhanced_word_markers() {
        let raw = "[00:12.00]<00:12.00>Hello <00:12.50>beautiful <00:13.00>world\n[00:15.00]Next\n";
        let doc = parse_lrc("test", raw, LyricSourceKind::Lrclib).unwrap();
        assert_eq!(doc.lines.len(), 2);
        assert_eq!(doc.lines[0].text, "Hello beautiful world");
        let words = doc.lines[0].words.as_ref().unwrap();
        assert_eq!(words.len(), 3);
        assert_eq!(words[0].text, "Hello ");
        assert_eq!(words[0].start_ms, 12000);
        assert_eq!(words[0].end_ms, 12500);
        assert_eq!(words[1].text, "beautiful ");
        assert_eq!(words[1].start_ms, 12500);
        assert_eq!(words[1].end_ms, 13000);
        assert_eq!(words[2].text, "world");
        assert_eq!(words[2].start_ms, 13000);
        // Last word ends at min(line_end, start + 2×typical_duration). For 5
        // chars: typical = 625ms, max = 1250ms → end = 13000 + 1250 = 14250.
        assert_eq!(words[2].end_ms, 14250);
    }

    #[test]
    fn plain_lrc_has_no_words() {
        let raw = "[00:01.00]Plain line\n[00:03.00]Another\n";
        let doc = parse_lrc("test", raw, LyricSourceKind::Lrclib).unwrap();
        assert!(doc.lines[0].words.is_none());
    }
}
