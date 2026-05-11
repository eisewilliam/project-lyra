use crate::domain::{LyricDocument, LyricLine, LyricSourceKind};
use anyhow::{anyhow, Result};

/// Parse an LRC string into a `LyricDocument`.
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
        if tag.contains(':') && !tag.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false) {
            continue;
        }

        // May have multiple timestamps on one line: [00:01.00][00:02.00]text
        let mut remaining = line;
        let mut timestamps: Vec<u64> = Vec::new();

        while remaining.starts_with('[') {
            let end = remaining.find(']').ok_or_else(|| anyhow!("unclosed bracket"))?;
            let ts_str = &remaining[1..end];
            if let Ok(ms) = parse_timestamp(ts_str) {
                timestamps.push(ms);
            }
            remaining = &remaining[end + 1..];
        }

        let text = remaining.trim().to_string();

        for ts in timestamps {
            lines.push(LyricLine { start_ms: ts, end_ms: None, text: text.clone() });
        }
    }

    if lines.is_empty() {
        return Err(anyhow!("no timed lines found"));
    }

    lines.sort_by_key(|l| l.start_ms);

    // Derive end_ms from the next line's start_ms
    let len = lines.len();
    for i in 0..len {
        if i + 1 < len {
            lines[i].end_ms = Some(lines[i + 1].start_ms);
        }
    }

    Ok(LyricDocument {
        track_key: track_key.to_string(),
        source,
        lines,
        raw_lrc: raw.to_string(),
    })
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
}
