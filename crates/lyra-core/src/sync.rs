use crate::domain::{
    LyricDocument, LyricsStatus, PlaybackState, PlaybackSnapshot, RenderSnapshot, VisibleLine,
};

/// Compute a `RenderSnapshot` from current playback + resolved lyrics.
pub fn compute_render(
    playback: PlaybackSnapshot,
    doc: Option<&LyricDocument>,
    status: LyricsStatus,
    context_above: usize,
    context_below: usize,
) -> RenderSnapshot {
    if playback.state == PlaybackState::Stopped || playback.track.is_none() {
        return RenderSnapshot {
            playback,
            lyrics_status: LyricsStatus::NotFound,
            active_line_index: None,
            line_progress: None,
            visible_lines: vec![],
        };
    }

    let Some(doc) = doc else {
        return RenderSnapshot {
            playback,
            lyrics_status: status,
            active_line_index: None,
            line_progress: None,
            visible_lines: vec![],
        };
    };

    let pos = playback.position_ms.unwrap_or(0);
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

    let visible_lines = build_visible(doc, active_idx, context_above, context_below);

    RenderSnapshot {
        playback,
        lyrics_status: LyricsStatus::Ready,
        active_line_index: active_idx,
        line_progress,
        visible_lines,
    }
}

fn find_active_line(lines: &[crate::domain::LyricLine], pos_ms: u64) -> Option<usize> {
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
    let Some(active_idx) = active else {
        return vec![];
    };

    let start = active_idx.saturating_sub(above);
    let end = (active_idx + below + 1).min(doc.lines.len());

    doc.lines[start..end]
        .iter()
        .enumerate()
        .map(|(offset, line)| VisibleLine {
            index: start + offset,
            text: line.text.clone(),
            is_active: (start + offset) == active_idx,
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
            .map(|(ms, text)| LyricLine { start_ms: *ms, end_ms: None, text: text.to_string() })
            .collect();

        let len = lines.len();
        for i in 0..len {
            if i + 1 < len {
                lines[i].end_ms = Some(lines[i + 1].start_ms);
            }
        }

        LyricDocument {
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
}
