//! Reading a lyrics file the user adds: LRC (timed) or plain text.
use crate::domain::{LyricChoiceError, LyricDocument, LyricSourceKind};
use crate::lyrics::parser;

/// Far larger than any real lyrics file; anything bigger is the wrong file.
pub const MAX_FILE_BYTES: u64 = 512 * 1024;

/// Turn a lyrics file into a document for `track_key`. A file with at least
/// one timed line is LRC; anything else is plain text, shown only in the
/// main window.
pub fn parse_user_lyrics(track_key: &str, bytes: &[u8]) -> Result<LyricDocument, LyricChoiceError> {
    if bytes.len() as u64 > MAX_FILE_BYTES {
        return Err(LyricChoiceError::TooLarge);
    }
    let text = decode(bytes)?.replace("\r\n", "\n").replace('\r', "\n");
    if text.trim().is_empty() {
        return Err(LyricChoiceError::Empty);
    }
    if let Ok(doc) = parser::parse_lrc(track_key, &text, LyricSourceKind::ManualOverride) {
        if !doc.lines.is_empty() {
            return Ok(doc);
        }
    }

    // No timed lines: plain text, without LRC tags such as `[ar: …]`.
    let plain = text
        .lines()
        .filter(|line| !is_lrc_tag(line))
        .map(str::trim_end)
        .collect::<Vec<_>>()
        .join("\n");
    let plain = plain.trim_matches('\n');
    if plain.trim().is_empty() {
        return Err(LyricChoiceError::Empty);
    }
    Ok(LyricDocument {
        track_key: track_key.to_owned(),
        source: LyricSourceKind::ManualOverride,
        lines: vec![],
        raw_lrc: String::new(),
        plain_lyrics: Some(plain.to_owned()),
        source_duration_ms: None,
    })
}

/// UTF-8, with or without a byte-order mark, or UTF-16 with one (what
/// Windows Notepad calls "Unicode").
fn decode(bytes: &[u8]) -> Result<String, LyricChoiceError> {
    let text = if let Some(rest) = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]) {
        String::from_utf8(rest.to_vec()).map_err(|_| LyricChoiceError::NotText)?
    } else if let Some(rest) = bytes.strip_prefix(&[0xFF, 0xFE]) {
        utf16(rest, u16::from_le_bytes)?
    } else if let Some(rest) = bytes.strip_prefix(&[0xFE, 0xFF]) {
        utf16(rest, u16::from_be_bytes)?
    } else {
        String::from_utf8(bytes.to_vec()).map_err(|_| LyricChoiceError::NotText)?
    };
    // Some binary files are valid UTF-8; text never contains NUL.
    if text.contains('\0') {
        return Err(LyricChoiceError::NotText);
    }
    Ok(text)
}

fn utf16(bytes: &[u8], read: fn([u8; 2]) -> u16) -> Result<String, LyricChoiceError> {
    if !bytes.len().is_multiple_of(2) {
        return Err(LyricChoiceError::NotText);
    }
    let units: Vec<u16> = bytes
        .chunks_exact(2)
        .map(|pair| read([pair[0], pair[1]]))
        .collect();
    String::from_utf16(&units).map_err(|_| LyricChoiceError::NotText)
}

/// An LRC metadata line (`[ar:Artist]`, `[offset:+120]`), not a section
/// label such as `[Chorus]` or `[Verse 1: Artist]`.
fn is_lrc_tag(line: &str) -> bool {
    let line = line.trim();
    let Some(inner) = line.strip_prefix('[').and_then(|l| l.strip_suffix(']')) else {
        return false;
    };
    inner
        .split_once(':')
        .is_some_and(|(tag, _)| !tag.is_empty() && tag.chars().all(|c| c.is_ascii_alphabetic()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timed_files_become_synced_lyrics() {
        let doc = parse_user_lyrics(
            "k",
            b"\xEF\xBB\xBF[ar:Someone]\r\n[00:01.00]First\r\n[00:02.50]Second\r\n",
        )
        .unwrap();
        assert_eq!(doc.lines.len(), 2);
        assert_eq!(doc.lines[1].text, "Second");
        assert!(doc.plain_lyrics.is_none());
        assert!(!doc.raw_lrc.contains('\r'));
        assert!(matches!(doc.source, LyricSourceKind::ManualOverride));
    }

    #[test]
    fn untimed_files_become_plain_lyrics_without_tags() {
        let doc = parse_user_lyrics(
            "k",
            b"[ti:Song]\n\n[Chorus]\nLa la la   \n[Verse 1: Artist]\nWords\n\n",
        )
        .unwrap();
        assert!(doc.lines.is_empty());
        assert_eq!(
            doc.plain_lyrics.as_deref(),
            Some("[Chorus]\nLa la la\n[Verse 1: Artist]\nWords")
        );
    }

    #[test]
    fn utf16_files_with_a_byte_order_mark_are_read() {
        let mut bytes = vec![0xFF, 0xFE];
        for unit in "[00:01.00]Héllo".encode_utf16() {
            bytes.extend_from_slice(&unit.to_le_bytes());
        }
        let doc = parse_user_lyrics("k", &bytes).unwrap();
        assert_eq!(doc.lines[0].text, "Héllo");
    }

    #[test]
    fn wrong_files_are_refused_with_a_reason() {
        assert_eq!(
            parse_user_lyrics("k", b"  \n\n").unwrap_err(),
            LyricChoiceError::Empty
        );
        assert_eq!(
            parse_user_lyrics("k", b"[ar:Only tags]\n[ti:Nothing else]").unwrap_err(),
            LyricChoiceError::Empty
        );
        assert_eq!(
            parse_user_lyrics("k", &[0x89, b'P', b'N', b'G', 0, 0xFF]).unwrap_err(),
            LyricChoiceError::NotText
        );
        assert_eq!(
            parse_user_lyrics("k", b"ID3\0\0\0text").unwrap_err(),
            LyricChoiceError::NotText
        );
        let huge = vec![b'a'; MAX_FILE_BYTES as usize + 1];
        assert_eq!(
            parse_user_lyrics("k", &huge).unwrap_err(),
            LyricChoiceError::TooLarge
        );
    }
}
