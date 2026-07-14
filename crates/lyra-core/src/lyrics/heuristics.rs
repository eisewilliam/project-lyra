use crate::domain::{NotFoundReason, TrackRef};

/// Detects if a track is likely classical, soundtrack/score, or instrumental
/// based on keywords in its title, artist, or album.
pub fn detect_non_lyric_reason(track: &TrackRef) -> Option<NotFoundReason> {
    let title = track.title.to_lowercase();
    let artist = track.artist.to_lowercase();
    let album = track.album.as_deref().map(|a| a.to_lowercase());

    // 1. Classical music detection
    let classical_composers = [
        "johann sebastian bach", "j.s. bach", "bach",
        "ludwig van beethoven", "beethoven",
        "wolfgang amadeus mozart", "w.a. mozart", "mozart",
        "frédéric chopin", "frederic chopin", "chopin",
        "pyotr ilyich tchaikovsky", "tchaikovsky",
        "claude debussy", "debussy",
        "franz liszt", "liszt",
        "sergei rachmaninoff", "rachmaninoff",
        "antonio vivaldi", "vivaldi",
        "franz schubert", "schubert",
        "johannes brahms", "brahms",
        "richard wagner", "wagner",
        "giuseppe verdi", "verdi",
        "johann strauss", "strauss",
        "felix mendelssohn", "mendelssohn",
        "robert schumann", "schumann",
        "joseph haydn", "haydn",
        "maurice ravel", "ravel",
        "igor stravinsky", "stravinsky",
    ];

    let has_classical_composer = classical_composers.iter().any(|composer| {
        artist == *composer 
            || artist.starts_with(&format!("{},", composer)) 
            || artist.contains(&format!(" {} ", composer))
            || artist.ends_with(&format!(" {}", composer))
    });

    let classical_keywords = [
        "symphony no.", "sonata no.", "concerto no.", "prelude in", "nocturne in",
        "op. ", "opus ", "philharmonic", "orchestra", "symphony orchestra",
        "string quartet", "orchestral suite"
    ];

    let has_classical_keywords = classical_keywords.iter().any(|kw| {
        title.contains(kw) || album.as_ref().is_some_and(|a| a.contains(kw))
    });

    if has_classical_composer || (has_classical_keywords && (artist.contains("orchestra") || artist.contains("philharmonic") || artist.contains("ensemble"))) {
        return Some(NotFoundReason::Classical);
    }

    // 2. Soundtrack detection
    let soundtrack_keywords = [
        "original soundtrack", "motion picture soundtrack", "original score",
        "music from the motion picture", "television soundtrack", "video game soundtrack",
        "theme from", "ost"
    ];
    let is_ost = soundtrack_keywords.iter().any(|kw| {
        title.contains(kw) || album.as_ref().is_some_and(|a| a.contains(kw))
    });

    let film_composers = [
        "hans zimmer", "john williams", "ludwig göransson", "ludwig goransson",
        "ramin djawadi", "howard shore", "danny elfman", "alan silvestri",
        "ennio morricone", "joe hisaishi", "clint mansell", "alexandre desplat",
        "trent reznor", "atticus ross", "thomas newman", "carter burwell",
        "bear mccreary", "steve jablonsky", "harry gregson-williams", "max richter",
        "johan johannsson", "johann johannsson", "vangelis"
    ];
    let is_film_composer = film_composers.iter().any(|composer| artist == *composer);

    if is_ost || is_film_composer {
        return Some(NotFoundReason::Soundtrack);
    }

    // 3. Instrumental detection
    let instrumental_keywords = [
        "(instrumental)", "instrumental version", "instrumental mix", "instrumental edit",
        "instrumental tracking", "backing track", "backing version", "karaoke version",
        "karaoke edit", "minus one", "piano version", "piano cover", "lo-fi beats", "lofi beats",
        "ambient mix", "meditation music", "relaxing piano", "sleep music"
    ];
    let has_instrumental_kw = instrumental_keywords.iter().any(|kw| {
        title.contains(kw) || artist.contains(kw) || album.as_ref().is_some_and(|a| a.contains(kw))
    });

    if has_instrumental_kw {
        return Some(NotFoundReason::Instrumental);
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::PlayerSource;

    fn make_track(title: &str, artist: &str, album: Option<&str>) -> TrackRef {
        TrackRef {
            source: PlayerSource::SpotifyMacOs,
            uri: "spotify:track:test".to_string(),
            title: title.to_string(),
            artist: artist.to_string(),
            album: album.map(|a| a.to_string()),
            duration_ms: 180000,
            artwork_url: None,
        }
    }

    #[test]
    fn detects_classical() {
        let t1 = make_track("Symphony No. 5 in C Minor, Op. 67: I. Allegro con brio", "Ludwig van Beethoven", None);
        assert_eq!(detect_non_lyric_reason(&t1), Some(NotFoundReason::Classical));

        let t2 = make_track("Nocturne in E-Flat Major, Op. 9, No. 2", "Frédéric Chopin", None);
        assert_eq!(detect_non_lyric_reason(&t2), Some(NotFoundReason::Classical));
    }

    #[test]
    fn detects_soundtrack() {
        let t1 = make_track("Time", "Hans Zimmer", Some("Inception (Music from the Motion Picture)"));
        assert_eq!(detect_non_lyric_reason(&t1), Some(NotFoundReason::Soundtrack));

        let t2 = make_track("Hedwig's Theme", "John Williams", Some("Harry Potter and the Sorcerer's Stone OST"));
        assert_eq!(detect_non_lyric_reason(&t2), Some(NotFoundReason::Soundtrack));
    }

    #[test]
    fn detects_instrumental() {
        let t1 = make_track("Song Title (Instrumental)", "Some Artist", None);
        assert_eq!(detect_non_lyric_reason(&t1), Some(NotFoundReason::Instrumental));

        let t2 = make_track("Chill Lofi Beat", "Lofi Beats", None);
        assert_eq!(detect_non_lyric_reason(&t2), Some(NotFoundReason::Instrumental));
    }
}
