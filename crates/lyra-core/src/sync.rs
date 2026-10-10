use crate::domain::{
    LyricDocument, LyricWord, LyricsStatus, NotFoundReason, PlaybackSnapshot, PlaybackState,
    RenderSnapshot, VisibleLine,
};

/// Compute a `RenderSnapshot` from current playback + resolved lyrics.
///
/// `offset_ms` is a per-track manual timing correction. A **positive** value
/// *delays* the lyrics (they switch later relative to the audio); negative
/// advances them. Internally we select lines against an offset-corrected
/// "effective" position, then shift emitted word timings back onto the real
/// playback clock so the frontend — which compares against the unmodified
/// playback position — stays aligned.
pub fn compute_render(
    playback: PlaybackSnapshot,
    doc: Option<&LyricDocument>,
    status: LyricsStatus,
    context_above: usize,
    context_below: usize,
    offset_ms: i64,
) -> RenderSnapshot {
    if playback.state == PlaybackState::Stopped || playback.track.is_none() {
        return RenderSnapshot {
            playback,
            lyrics_status: LyricsStatus::NotFound {
                reason: NotFoundReason::Miss,
            },
            active_line_index: None,
            line_progress: None,
            visible_lines: vec![],
            active_line_words: None,
        };
    }

    let Some(doc) = doc else {
        return RenderSnapshot {
            playback,
            lyrics_status: status,
            active_line_index: None,
            line_progress: None,
            visible_lines: vec![],
            active_line_words: None,
        };
    };

    if doc.plain_lyrics.is_some() && doc.lines.is_empty() {
        return RenderSnapshot {
            playback,
            lyrics_status: LyricsStatus::Unsynced,
            active_line_index: None,
            line_progress: None,
            visible_lines: vec![],
            active_line_words: None,
        };
    }

    let raw_pos = playback.position_ms.unwrap_or(0);
    // Offset-corrected position used for *line selection*: a positive offset
    // delays lyrics, so a line at lyric-time T becomes active at playback-time
    // T + offset — i.e. compare against (pos - offset).
    let pos = (raw_pos as i64 - offset_ms).max(0) as u64;
    let active_idx = find_active_line(&doc.lines, pos);

    let line_progress = active_idx.and_then(|i| {
        let line = &doc.lines[i];
        let end = line.end_ms.unwrap_or(u64::MAX);
        if end == u64::MAX {
            return None;
        }
        let span = end.saturating_sub(line.start_ms);
        if span == 0 {
            return None;
        }
        let elapsed = pos.saturating_sub(line.start_ms);
        Some((elapsed as f32 / span as f32).clamp(0.0, 1.0))
    });

    let active_line_words = active_idx.and_then(|i| {
        let line = &doc.lines[i];
        let raw_end = line.end_ms?;
        if raw_end <= line.start_ms || line.text.trim().is_empty() {
            return None;
        }
        let words = match &line.words {
            Some(words) if !words.is_empty() => words.clone(),
            _ => {
                // Smart cap for interpolation: when the gap to the next line is
                // much longer than the line's text "should" take to sing, cap
                // the interpolation window so words don't drag through silence.
                // Heuristic: 8 chars/sec typical singing pace; allow 2x slack
                // (≈4 chars/sec) for slow ballads before clamping.
                let smart_end = smart_interp_end(&line.text, line.start_ms, raw_end);
                interpolate_words(&line.text, line.start_ms, smart_end)
            }
        };
        // Shift word timings from the lyric clock onto the real playback clock
        // so the frontend (which animates against the unmodified position)
        // colours words in sync with the offset-corrected active line.
        Some(shift_words(words, offset_ms))
    });

    let visible_lines = build_visible(doc, active_idx, context_above, context_below);

    RenderSnapshot {
        playback,
        lyrics_status: LyricsStatus::Ready,
        active_line_index: active_idx,
        line_progress,
        visible_lines,
        active_line_words,
    }
}

/// Cap the interpolation window so words don't drag across long instrumental
/// gaps. Returns `min(raw_end, start_ms + 2 × typical_singing_duration)`.
/// Typical singing = ~8 chars/sec; the 2× multiplier allows ballads (~4
/// chars/sec) without compressing genuinely slow vocals.
fn smart_interp_end(text: &str, start_ms: u64, raw_end_ms: u64) -> u64 {
    let chars = text.chars().filter(|c| !c.is_whitespace()).count() as u64;
    if chars == 0 {
        return raw_end_ms;
    }
    let typical_ms = chars * 1000 / 8;
    // Floor of 800 ms so short single-syllable lines still get a usable window.
    let max_ms = (typical_ms * 2).max(800);
    let raw_duration = raw_end_ms - start_ms;
    start_ms + raw_duration.min(max_ms)
}

/// Distribute `[start_ms, end_ms]` across whitespace-separated tokens
/// proportional to character count. Each token retains its trailing space so
/// rendered output remains visually identical to the original line.
fn interpolate_words(text: &str, start_ms: u64, end_ms: u64) -> Vec<LyricWord> {
    let tokens: Vec<&str> = text.split_inclusive(char::is_whitespace).collect();
    if tokens.is_empty() {
        return vec![];
    }

    // Use character count of trimmed token (skip leading/trailing whitespace).
    let weights: Vec<usize> = tokens
        .iter()
        .map(|t| t.trim().chars().count().max(1))
        .collect();
    let total_weight: usize = weights.iter().sum::<usize>().max(1);
    let total_ms = end_ms.saturating_sub(start_ms);

    let mut result = Vec::with_capacity(tokens.len());
    let mut cursor = start_ms;
    let count = tokens.len();
    for (i, (tok, w)) in tokens.iter().zip(weights.iter()).enumerate() {
        let dur = total_ms * (*w as u64) / total_weight as u64;
        let word_end = if i + 1 == count { end_ms } else { cursor + dur };
        result.push(LyricWord {
            start_ms: cursor,
            end_ms: word_end,
            text: tok.to_string(),
        });
        cursor = word_end;
    }
    result
}

/// Shift every word's start/end by `offset_ms` (saturating at 0) to translate
/// lyric-clock timings onto the playback clock.
fn shift_words(words: Vec<LyricWord>, offset_ms: i64) -> Vec<LyricWord> {
    if offset_ms == 0 {
        return words;
    }
    let shift = |t: u64| (t as i64 + offset_ms).max(0) as u64;
    words
        .into_iter()
        .map(|w| LyricWord {
            start_ms: shift(w.start_ms),
            end_ms: shift(w.end_ms),
            text: w.text,
        })
        .collect()
}

pub fn find_active_line(lines: &[crate::domain::LyricLine], pos_ms: u64) -> Option<usize> {
    if lines.is_empty() {
        return None;
    }

    // Binary-search for the last line whose start_ms <= pos_ms
    let idx = lines.partition_point(|l| l.start_ms <= pos_ms);
    if idx == 0 {
        return None;
    }
    Some(idx - 1)
}

fn build_visible(
    doc: &LyricDocument,
    active: Option<usize>,
    above: usize,
    below: usize,
) -> Vec<VisibleLine> {
    let (start, end, active_idx) = match active {
        Some(active_idx) => (
            active_idx.saturating_sub(above),
            (active_idx + below + 1).min(doc.lines.len()),
            Some(active_idx),
        ),
        None => {
            if doc.lines.is_empty() {
                return vec![];
            }
            (0, (below + 1).min(doc.lines.len()), None)
        }
    };

    doc.lines[start..end]
        .iter()
        .enumerate()
        .map(|(offset, line)| VisibleLine {
            index: start + offset,
            text: line.text.clone(),
            is_active: active_idx == Some(start + offset),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{LyricLine, LyricSourceKind};

    fn make_doc(timestamps: &[(u64, &str)]) -> LyricDocument {
        let mut lines: Vec<LyricLine> = timestamps
            .iter()
            .map(|(ms, text)| LyricLine {
                start_ms: *ms,
                end_ms: None,
                text: text.to_string(),
                words: None,
            })
            .collect();

        let len = lines.len();
        for i in 0..len {
            if i + 1 < len {
                lines[i].end_ms = Some(lines[i + 1].start_ms);
            }
        }

        LyricDocument {
            plain_lyrics: None,
            track_key: "test".into(),
            source: LyricSourceKind::Lrclib,
            lines,
            raw_lrc: "".into(),
        }
    }

    #[test]
    fn selects_correct_active_line() {
        let doc = make_doc(&[(0, "Intro"), (3000, "Verse"), (6000, "Chorus")]);
        let lines = &doc.lines;
        assert_eq!(find_active_line(lines, 0), Some(0));
        assert_eq!(find_active_line(lines, 2999), Some(0));
        assert_eq!(find_active_line(lines, 3000), Some(1));
        assert_eq!(find_active_line(lines, 7000), Some(2));
    }

    #[test]
    fn returns_none_before_first_line() {
        let doc = make_doc(&[(5000, "First")]);
        assert_eq!(find_active_line(&doc.lines, 1000), None);
    }

    #[test]
    fn shows_first_visible_lines_before_first_timestamp() {
        let doc = make_doc(&[(5000, "First"), (7000, "Second"), (9000, "Third")]);
        let visible = build_visible(&doc, None, 1, 1);
        assert_eq!(visible.len(), 2);
        assert_eq!(visible[0].text, "First");
        assert_eq!(visible[1].text, "Second");
        assert!(!visible[0].is_active);
        assert!(!visible[1].is_active);
    }

    #[test]
    fn interpolates_words_by_char_count() {
        let words = interpolate_words("Hello world", 0, 1000);
        assert_eq!(words.len(), 2);
        assert_eq!(words[0].text, "Hello ");
        assert_eq!(words[0].start_ms, 0);
        // Char-count uses trimmed tokens: "Hello"=5, "world"=5 → split 50/50.
        assert_eq!(words[0].end_ms, 500);
        assert_eq!(words[1].text, "world");
        // Last word always ends exactly at line end.
        assert_eq!(words[1].end_ms, 1000);
    }

    #[test]
    fn interpolate_words_handles_single_word() {
        let words = interpolate_words("Hi", 100, 500);
        assert_eq!(words.len(), 1);
        assert_eq!(words[0].start_ms, 100);
        assert_eq!(words[0].end_ms, 500);
    }

    fn render_at(pos_ms: u64, offset_ms: i64) -> RenderSnapshot {
        let doc = make_doc(&[(0, "Intro"), (3000, "Verse"), (6000, "Chorus")]);
        let playback = PlaybackSnapshot {
            track: Some(crate::domain::TrackRef {
                duration_ms: 9000,
                ..crate::domain::TrackRef::fixture("spotify:track:t")
            }),
            state: PlaybackState::Playing,
            position_ms: Some(pos_ms),
            ..PlaybackSnapshot::stopped(0)
        };
        compute_render(playback, Some(&doc), LyricsStatus::Ready, 1, 1, offset_ms)
    }

    #[test]
    fn positive_offset_delays_active_line() {
        // At 3100ms with no offset the "Verse" line (start 3000) is active.
        assert_eq!(render_at(3100, 0).active_line_index, Some(1));
        // A +500ms delay means lyrics lag: at 3100ms we should still be on
        // "Intro" (effective position 2600 < 3000).
        assert_eq!(render_at(3100, 500).active_line_index, Some(0));
    }

    #[test]
    fn negative_offset_advances_active_line() {
        // At 2900ms with no offset "Intro" is active.
        assert_eq!(render_at(2900, 0).active_line_index, Some(0));
        // A -200ms offset advances lyrics: effective 3100 ≥ 3000 → "Verse".
        assert_eq!(render_at(2900, -200).active_line_index, Some(1));
    }
}
