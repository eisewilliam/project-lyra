//! Cover art for players that share artwork only as image data.
//!
//! Discord fetches an activity's image itself, so it needs a public URL.
//! `CoverArt` finds one in Apple's music catalogue (the iTunes Search API)
//! by artist and title. Lookups run on their own thread: `cover_for` only
//! reads the cache and queues a lookup, so it never blocks the poll driver.

use std::num::NonZeroUsize;
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use lru::LruCache;
use serde::Deserialize;

use crate::domain::TrackRef;
use crate::lyrics::lrclib::{
    base_title, lead_artist, normalize_for_compare, strip_feature_annotations, USER_AGENT,
};

const SEARCH_URL: &str = "https://itunes.apple.com/search";
/// Results asked for per search; the right release is usually among the
/// first few.
const SEARCH_LIMIT: &str = "10";
/// Tracks and albums remembered, found or not, until Lyra quits.
const CACHE_ENTRIES: usize = 512;
/// Apple allows roughly 20 searches a minute; stay well under.
const REQUEST_SPACING: Duration = Duration::from_secs(3);
/// How long nothing is sent after Apple refuses a search as too frequent.
const RATE_LIMIT_PAUSE: Duration = Duration::from_secs(60);
/// How long before a failed lookup (no connection, server error) is tried
/// again for the same track.
const RETRY_AFTER_FAILURE: Duration = Duration::from_secs(5 * 60);
/// A result this close to the player's track length is the same recording.
const DURATION_TOLERANCE_MS: u64 = 3_000;
/// Apple's artwork URLs end in the size; this asks for a larger image than
/// the 100-pixel one the search returns.
const ARTWORK_SIZE_RETURNED: &str = "/100x100bb.jpg";
const ARTWORK_SIZE_WANTED: &str = "/512x512bb.jpg";

type Listener = Box<dyn Fn() + Send + Sync>;

pub(crate) struct CoverArt {
    shared: Arc<Shared>,
    /// `None` when lookups are off or the lookup thread could not start.
    requests: Option<mpsc::Sender<Request>>,
    retry_after_failure: Duration,
}

struct Shared {
    entries: Mutex<LruCache<String, Entry>>,
    on_found: Mutex<Option<Listener>>,
}

enum Entry {
    Found(String),
    /// The catalogue answered and has no matching song.
    Miss,
    Pending,
    /// The lookup could not be completed; not a miss, so it is retried.
    Failed(Instant),
}

struct Request {
    key: String,
    album_key: Option<String>,
    query: Query,
}

struct Query {
    title: String,
    artist: String,
    album: Option<String>,
    duration_ms: u64,
}

struct Timing {
    spacing: Duration,
    rate_limit_pause: Duration,
}

impl CoverArt {
    pub(crate) fn new() -> Self {
        Self::with_endpoint(
            SEARCH_URL.to_owned(),
            Timing {
                spacing: REQUEST_SPACING,
                rate_limit_pause: RATE_LIMIT_PAUSE,
            },
            RETRY_AFTER_FAILURE,
        )
    }

    /// Never looks anything up.
    pub(crate) fn disabled() -> Self {
        Self {
            shared: Arc::new(Shared::new()),
            requests: None,
            retry_after_failure: RETRY_AFTER_FAILURE,
        }
    }

    fn with_endpoint(search_url: String, timing: Timing, retry_after_failure: Duration) -> Self {
        let shared = Arc::new(Shared::new());
        let (sender, receiver) = mpsc::channel();
        let worker_shared = Arc::clone(&shared);
        let spawned = std::thread::Builder::new()
            .name("discord-cover".into())
            .spawn(move || run(&worker_shared, &receiver, &search_url, &timing));
        Self {
            shared,
            requests: spawned.is_ok().then_some(sender),
            retry_after_failure,
        }
    }

    /// Called from the lookup thread each time a cover is found.
    pub(crate) fn on_found(&self, listener: impl Fn() + Send + Sync + 'static) {
        *lock(&self.shared.on_found) = Some(Box::new(listener));
    }

    /// The cover for `track` if it is already known. Otherwise starts a
    /// lookup, unless one is running or the catalogue has no such song, and
    /// returns `None`; `on_found` fires when the lookup finds a cover.
    pub(crate) fn cover_for(&self, track: &TrackRef) -> Option<String> {
        let requests = self.requests.as_ref()?;
        let title = track.title.trim();
        let artist = track.artist.trim();
        if title.is_empty() || artist.is_empty() {
            // Without both there is nothing to check a result against.
            return None;
        }
        let album = track
            .album
            .as_deref()
            .map(str::trim)
            .filter(|album| !album.is_empty());
        let artist_key = normalize_for_compare(artist);
        let album_part = album.map(album_name).unwrap_or_default();
        // The album is part of a track's key: the same title on another
        // album has another cover.
        let key = format!(
            "track\u{1f}{artist_key}\u{1f}{}\u{1f}{album_part}",
            normalize_for_compare(title)
        );
        let album_key = album.map(|_| format!("album\u{1f}{artist_key}\u{1f}{album_part}"));

        let mut entries = lock(&self.shared.entries);
        if let Some(Entry::Found(url)) = album_key.as_ref().and_then(|key| entries.get(key)) {
            return Some(url.clone());
        }
        match entries.get(&key) {
            Some(Entry::Found(url)) => return Some(url.clone()),
            Some(Entry::Miss | Entry::Pending) => return None,
            Some(Entry::Failed(at)) if at.elapsed() < self.retry_after_failure => return None,
            Some(Entry::Failed(_)) | None => {}
        }
        let request = Request {
            key: key.clone(),
            album_key,
            query: Query {
                title: title.to_owned(),
                artist: artist.to_owned(),
                album: album.map(str::to_owned),
                duration_ms: track.duration_ms,
            },
        };
        if requests.send(request).is_ok() {
            entries.put(key, Entry::Pending);
        }
        None
    }
}

impl Shared {
    fn new() -> Self {
        Self {
            entries: Mutex::new(LruCache::new(
                NonZeroUsize::new(CACHE_ENTRIES).unwrap_or(NonZeroUsize::MIN),
            )),
            on_found: Mutex::new(None),
        }
    }

    /// Drop a lookup that was never made, so the track can ask again.
    fn forget(&self, key: &str) {
        let mut entries = lock(&self.entries);
        if matches!(entries.peek(key), Some(Entry::Pending)) {
            entries.pop(key);
        }
    }
}

/// The lookup thread: one search at a time, spaced out, newest track first.
/// Runs until the `CoverArt` handle is dropped.
fn run(shared: &Shared, requests: &mpsc::Receiver<Request>, search_url: &str, timing: &Timing) {
    let Ok(runtime) = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
    else {
        return;
    };
    let http = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .connect_timeout(Duration::from_secs(5))
        .user_agent(USER_AGENT)
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());

    let mut next_allowed = Instant::now();
    while let Ok(mut request) = requests.recv() {
        // Wait out the spacing. A request arriving meanwhile replaces this
        // one: the user has moved on to another track.
        loop {
            let wait = next_allowed.saturating_duration_since(Instant::now());
            let newer = if wait.is_zero() {
                requests.try_recv().ok()
            } else {
                match requests.recv_timeout(wait) {
                    Ok(newer) => Some(newer),
                    Err(RecvTimeoutError::Timeout) => None,
                    Err(RecvTimeoutError::Disconnected) => return,
                }
            };
            match newer {
                Some(newer) => {
                    shared.forget(&request.key);
                    request = newer;
                }
                None if wait.is_zero() => break,
                None => {}
            }
        }

        let outcome = runtime.block_on(search(&http, search_url, &request.query));
        next_allowed = Instant::now()
            + match outcome {
                Err(SearchError::RateLimited) => timing.rate_limit_pause,
                _ => timing.spacing,
            };

        let found = matches!(outcome, Ok(Some(_)));
        {
            let mut entries = lock(&shared.entries);
            match outcome {
                Ok(Some(cover)) => {
                    if let (Some(album_key), true) = (request.album_key, cover.album_matched) {
                        entries.put(album_key, Entry::Found(cover.url.clone()));
                    }
                    entries.put(request.key, Entry::Found(cover.url));
                }
                Ok(None) => {
                    entries.put(request.key, Entry::Miss);
                }
                Err(_) => {
                    entries.put(request.key, Entry::Failed(Instant::now()));
                }
            }
        }
        if found {
            if let Some(listener) = lock(&shared.on_found).as_ref() {
                listener();
            }
        }
    }
}

enum SearchError {
    RateLimited,
    Unavailable,
}

#[derive(Deserialize)]
struct SearchResponse {
    #[serde(default)]
    results: Vec<SearchResult>,
}

#[derive(Deserialize)]
struct SearchResult {
    #[serde(rename = "artistName")]
    artist: Option<String>,
    #[serde(rename = "trackName")]
    title: Option<String>,
    #[serde(rename = "collectionName")]
    album: Option<String>,
    #[serde(rename = "trackTimeMillis")]
    duration_ms: Option<u64>,
    #[serde(rename = "artworkUrl100")]
    artwork_url: Option<String>,
}

#[derive(Debug, PartialEq, Eq)]
struct Cover {
    url: String,
    /// The result is from the album the player named, so the cover holds
    /// for the album's other tracks too.
    album_matched: bool,
}

/// `Ok(None)` only when the catalogue answered and nothing matched.
async fn search(
    http: &reqwest::Client,
    search_url: &str,
    query: &Query,
) -> Result<Option<Cover>, SearchError> {
    let url = reqwest::Url::parse_with_params(
        search_url,
        [
            ("term", search_term(query).as_str()),
            ("media", "music"),
            ("entity", "song"),
            ("limit", SEARCH_LIMIT),
        ],
    )
    .map_err(|_| SearchError::Unavailable)?;
    let response = http
        .get(url)
        .send()
        .await
        .map_err(|_| SearchError::Unavailable)?;
    match response.status().as_u16() {
        200 => {}
        403 | 429 => return Err(SearchError::RateLimited),
        _ => return Err(SearchError::Unavailable),
    }
    let body: SearchResponse = response
        .json()
        .await
        .map_err(|_| SearchError::Unavailable)?;
    Ok(pick_cover(query, &body.results))
}

/// The lead artist and the title without its "feat." note: the words most
/// likely to be in the catalogue's own entry.
fn search_term(query: &Query) -> String {
    let artist = lead_artist(&query.artist).unwrap_or(&query.artist);
    let title = strip_feature_annotations(&query.title).unwrap_or_else(|| query.title.clone());
    format!("{artist} {title}")
}

/// The best result that is certainly this song, or `None`: no cover is
/// better than the wrong one. Title and lead artist must match; album and
/// length only choose between results that do.
fn pick_cover(query: &Query, results: &[SearchResult]) -> Option<Cover> {
    let title = comparable_title(&query.title);
    let artist = comparable_artist(&query.artist);
    let album = query.album.as_deref().map(album_name);

    let mut best: Option<(u8, Cover)> = None;
    for result in results {
        let (Some(result_title), Some(result_artist), Some(artwork)) =
            (&result.title, &result.artist, &result.artwork_url)
        else {
            continue;
        };
        let Some(url) = artwork_url(artwork) else {
            continue;
        };
        if comparable_artist(result_artist) != artist {
            continue;
        }
        let result_title = comparable_title(result_title);
        let title_score = if result_title == title {
            4
        } else if base_title(&result_title) == base_title(&title) {
            // The same song in another version, such as a remaster.
            1
        } else {
            continue;
        };
        let album_matched = match (&album, &result.album) {
            (Some(album), Some(result_album)) => *album == album_name(result_album),
            _ => false,
        };
        let same_length = query.duration_ms > 0
            && result
                .duration_ms
                .is_some_and(|ms| ms.abs_diff(query.duration_ms) <= DURATION_TOLERANCE_MS);
        let score = title_score + 2 * u8::from(album_matched) + u8::from(same_length);
        // Results arrive most relevant first, so an equal score keeps the
        // earlier one.
        if best.as_ref().is_none_or(|(top, _)| score > *top) {
            best = Some((score, Cover { url, album_matched }));
        }
    }
    best.map(|(_, cover)| cover)
}

fn comparable_title(title: &str) -> String {
    normalize_for_compare(strip_feature_annotations(title).as_deref().unwrap_or(title))
}

fn comparable_artist(artist: &str) -> String {
    normalize_for_compare(lead_artist(artist).unwrap_or(artist))
}

/// An album name for comparison. Apple adds " - Single" and " - EP" to
/// release names; other players leave them off.
fn album_name(album: &str) -> String {
    let name = normalize_for_compare(album);
    for suffix in [" single", " ep"] {
        if let Some(stripped) = name.strip_suffix(suffix) {
            if !stripped.is_empty() {
                return stripped.to_owned();
            }
        }
    }
    name
}

/// A larger rendition of a search result's artwork; `None` unless it is a
/// public `https` URL.
fn artwork_url(returned: &str) -> Option<String> {
    if !returned.starts_with("https://") {
        return None;
    }
    Some(match returned.strip_suffix(ARTWORK_SIZE_RETURNED) {
        Some(base) => format!("{base}{ARTWORK_SIZE_WANTED}"),
        None => returned.to_owned(),
    })
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|e| e.into_inner())
}

#[cfg(test)]
pub(crate) mod test_support {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    /// One search result as Apple's catalogue would return it.
    pub(crate) fn result(artist: &str, title: &str, album: &str, cover: &str) -> String {
        serde_json::json!({
            "artistName": artist,
            "trackName": title,
            "collectionName": album,
            "trackTimeMillis": 180_000,
            "artworkUrl100": format!("https://covers.test/{cover}/100x100bb.jpg"),
        })
        .to_string()
    }

    pub(crate) fn found(results: &[String]) -> (u16, String) {
        (200, format!(r#"{{"results":[{}]}}"#, results.join(",")))
    }

    /// The URL `CoverArt` publishes for a `result` whose cover is `cover`.
    pub(crate) fn cover_url(cover: &str) -> String {
        format!("https://covers.test/{cover}/512x512bb.jpg")
    }

    /// A `CoverArt` whose catalogue answers each search in turn; searches
    /// past the last answer find no server. The counter is how many
    /// searches arrived.
    pub(crate) fn catalogue(responses: Vec<(u16, String)>) -> (CoverArt, Arc<AtomicUsize>) {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let search_url = format!("http://{}/search", listener.local_addr().unwrap());
        let searches = Arc::new(AtomicUsize::new(0));
        let counted = Arc::clone(&searches);
        std::thread::spawn(move || {
            for (status, body) in responses {
                let Ok((mut stream, _)) = listener.accept() else {
                    return;
                };
                let mut request = [0; 8192];
                let _ = stream.read(&mut request);
                counted.fetch_add(1, Ordering::SeqCst);
                let _ = write!(
                    stream,
                    "HTTP/1.1 {status} Test\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
            }
        });
        let covers = CoverArt::with_endpoint(
            search_url,
            Timing {
                spacing: Duration::ZERO,
                rate_limit_pause: Duration::ZERO,
            },
            Duration::ZERO,
        );
        (covers, searches)
    }
}

#[cfg(test)]
mod tests {
    use super::test_support::{catalogue, cover_url, found, result};
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn track(artist: &str, title: &str, album: Option<&str>) -> TrackRef {
        TrackRef {
            artist: artist.into(),
            title: title.into(),
            album: album.map(str::to_owned),
            ..TrackRef::fixture("meta::cover")
        }
    }

    fn query(artist: &str, title: &str, album: Option<&str>) -> Query {
        Query {
            title: title.into(),
            artist: artist.into(),
            album: album.map(str::to_owned),
            duration_ms: 180_000,
        }
    }

    fn results(entries: &[String]) -> Vec<SearchResult> {
        serde_json::from_str::<SearchResponse>(&found(entries).1)
            .unwrap()
            .results
    }

    /// Ask until the lookup thread has settled on an answer.
    fn eventually(covers: &CoverArt, track: &TrackRef) -> Option<String> {
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            if let Some(url) = covers.cover_for(track) {
                return Some(url);
            }
            let settled = !lock(&covers.shared.entries)
                .iter()
                .any(|(_, entry)| matches!(entry, Entry::Pending));
            if settled || Instant::now() > deadline {
                return covers.cover_for(track);
            }
            std::thread::sleep(Duration::from_millis(5));
        }
    }

    fn wait_for_searches(searches: &AtomicUsize, count: usize) {
        let deadline = Instant::now() + Duration::from_secs(5);
        while searches.load(Ordering::SeqCst) < count {
            assert!(
                Instant::now() < deadline,
                "timed out waiting for search {count}"
            );
            std::thread::sleep(Duration::from_millis(5));
        }
    }

    #[test]
    fn the_album_the_player_named_wins_over_an_earlier_result() {
        let cover = pick_cover(
            &query("Artist", "Song", Some("Album")),
            &results(&[
                result("Artist", "Song", "Greatest Hits", "hits"),
                result("Artist", "Song", "Album - Single", "album"),
            ]),
        );
        assert_eq!(
            cover,
            Some(Cover {
                url: cover_url("album"),
                album_matched: true,
            })
        );
    }

    #[test]
    fn a_shared_credit_matches_by_its_lead_artist() {
        let cover = pick_cover(
            &query("Daft Punk", "Get Lucky (feat. Pharrell Williams)", None),
            &results(&[result(
                "Daft Punk, Pharrell Williams & Nile Rodgers",
                "Get Lucky",
                "Random Access Memories",
                "ram",
            )]),
        );
        assert_eq!(cover.unwrap().url, cover_url("ram"));
    }

    #[test]
    fn another_artist_or_another_song_is_not_accepted() {
        let wanted = query("Artist", "Song", Some("Album"));
        assert_eq!(
            pick_cover(
                &wanted,
                &results(&[
                    result("Tribute Band", "Song", "Album", "tribute"),
                    result("Artist", "Songbird", "Album", "other-song"),
                ])
            ),
            None
        );
    }

    #[test]
    fn a_remaster_is_accepted_but_ranks_below_the_exact_title() {
        let wanted = query("Artist", "Song", None);
        let remaster = result("Artist", "Song (Remastered 2011)", "Album", "remaster");
        assert_eq!(
            pick_cover(&wanted, &results(std::slice::from_ref(&remaster)))
                .unwrap()
                .url,
            cover_url("remaster")
        );
        let exact = result("Artist", "Song", "Album", "exact");
        assert_eq!(
            pick_cover(&wanted, &results(&[remaster, exact]))
                .unwrap()
                .url,
            cover_url("exact")
        );
    }

    #[test]
    fn artwork_must_be_a_public_https_url() {
        assert_eq!(artwork_url("http://covers.test/a/100x100bb.jpg"), None);
        assert_eq!(
            artwork_url("https://covers.test/a/100x100bb.jpg").unwrap(),
            "https://covers.test/a/512x512bb.jpg"
        );
        assert_eq!(
            artwork_url("https://covers.test/a.png").unwrap(),
            "https://covers.test/a.png"
        );
    }

    #[test]
    fn a_found_cover_is_looked_up_once_and_serves_the_whole_album() {
        let (covers, searches) =
            catalogue(vec![found(&[result("Artist", "Song", "Album", "album")])]);
        let notified = Arc::new(AtomicUsize::new(0));
        let counter = Arc::clone(&notified);
        covers.on_found(move || {
            counter.fetch_add(1, Ordering::SeqCst);
        });

        let song = track("Artist", "Song", Some("Album"));
        assert_eq!(covers.cover_for(&song), None, "not known yet");
        assert_eq!(eventually(&covers, &song), Some(cover_url("album")));
        assert_eq!(notified.load(Ordering::SeqCst), 1);

        // Another track on the album needs no search of its own; a second
        // search would find no server and no cover.
        let next = track("Artist", "Another Song", Some("Album"));
        assert_eq!(covers.cover_for(&next), Some(cover_url("album")));
        assert_eq!(searches.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn the_same_title_on_another_album_gets_its_own_cover() {
        let (covers, searches) = catalogue(vec![
            found(&[result("Artist", "Song", "Studio Album", "studio")]),
            found(&[result("Artist", "Song", "Live Album", "live")]),
        ]);
        let studio = track("Artist", "Song", Some("Studio Album"));
        let live = track("Artist", "Song", Some("Live Album"));
        assert_eq!(eventually(&covers, &studio), Some(cover_url("studio")));
        assert_eq!(eventually(&covers, &live), Some(cover_url("live")));
        assert_eq!(covers.cover_for(&studio), Some(cover_url("studio")));
        assert_eq!(searches.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn a_song_the_catalogue_lacks_is_not_searched_again() {
        let (covers, searches) = catalogue(vec![found(&[]), found(&[])]);
        let song = track("Artist", "Song", None);
        assert_eq!(eventually(&covers, &song), None);
        assert_eq!(covers.cover_for(&song), None);
        std::thread::sleep(Duration::from_millis(50));
        assert_eq!(searches.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn a_failed_search_is_not_a_miss_and_is_tried_again() {
        for failure in [500, 429] {
            let (covers, searches) = catalogue(vec![
                (failure, String::new()),
                found(&[result("Artist", "Song", "Album", "album")]),
            ]);
            let song = track("Artist", "Song", None);
            assert_eq!(covers.cover_for(&song), None);
            wait_for_searches(&searches, 1);
            assert_eq!(eventually(&covers, &song), Some(cover_url("album")));
            assert_eq!(searches.load(Ordering::SeqCst), 2);
        }
    }

    #[test]
    fn nothing_is_searched_without_both_a_title_and_an_artist() {
        let (covers, searches) = catalogue(vec![found(&[])]);
        assert_eq!(covers.cover_for(&track("", "Song", None)), None);
        assert_eq!(covers.cover_for(&track("Artist", " ", None)), None);
        assert_eq!(
            CoverArt::disabled().cover_for(&track("Artist", "Song", None)),
            None
        );
        std::thread::sleep(Duration::from_millis(50));
        assert_eq!(searches.load(Ordering::SeqCst), 0);
    }
}
