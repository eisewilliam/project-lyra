use crate::domain::TrackRef;
use serde::Deserialize;

#[derive(Deserialize, Debug, Clone)]
pub struct GeniusSong {
    pub id: i64,
    pub instrumental: bool,
    pub path: String,
    pub full_title: String,
}

#[derive(Deserialize, Debug)]
struct GeniusSearchResponse {
    response: GeniusResponse,
}

#[derive(Deserialize, Debug)]
struct GeniusResponse {
    sections: Vec<GeniusSection>,
}

#[derive(Deserialize, Debug)]
struct GeniusSection {
    #[serde(rename = "type")]
    #[allow(dead_code)]
    section_type: String,
    hits: Vec<GeniusHit>,
}

#[derive(Deserialize, Debug)]
struct GeniusHit {
    #[serde(rename = "type")]
    hit_type: String,
    result: GeniusSong,
}

pub struct GeniusClient {
    http: reqwest::Client,
}

impl GeniusClient {
    pub fn new() -> Self {
        let http = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36")
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());
        Self { http }
    }

    /// Search for a song on Genius using their public endpoint.
    pub async fn search(&self, track: &TrackRef) -> Option<GeniusSong> {
        let query = format!("{} {}", track.artist, track.title);
        let url = format!(
            "https://genius.com/api/search/multi?q={}",
            urlencoding::encode(&query)
        );

        let resp = self.http.get(&url).send().await.ok()?;
        if !resp.status().is_success() {
            return None;
        }

        let search_data: GeniusSearchResponse = resp.json().await.ok()?;
        
        // Find the first hit that is a song across all sections
        for section in search_data.response.sections {
            for hit in section.hits {
                if hit.hit_type == "song" {
                    // Check if it's a reasonably close match (simple substring check)
                    let hit_title = hit.result.full_title.to_lowercase();
                    let query_title = track.title.to_lowercase();
                    if hit_title.contains(&query_title) || query_title.contains(&hit.result.full_title.to_lowercase()) {
                        return Some(hit.result);
                    }
                }
            }
        }

        None
    }

    /// Fetch and scrape the plain text lyrics from a Genius song page.
    pub async fn fetch_lyrics(&self, path: &str) -> Option<String> {
        let url = format!("https://genius.com{}", path);
        let resp = self.http.get(&url).send().await.ok()?;
        if !resp.status().is_success() {
            return None;
        }

        let html = resp.text().await.ok()?;
        let lyrics = extract_genius_lyrics(&html);
        if lyrics.trim().is_empty() {
            None
        } else {
            Some(lyrics)
        }
    }
}

fn extract_genius_lyrics(html: &str) -> String {
    let mut lyrics = String::new();
    let parts: Vec<&str> = html.split("data-lyrics-container=\"true\"").collect();
    
    if parts.len() > 1 {
        for part in parts.iter().skip(1) {
            // Find the end of the opening tag
            let Some(start_idx) = part.find('>') else { continue };
            
            let mut inside_tag = false;
            let mut current_tag = String::new();
            let mut container_depth = 1;
            let mut chars = part[start_idx + 1..].char_indices().peekable();
            
            while let Some((_, c)) = chars.next() {
                if c == '<' {
                    inside_tag = true;
                    current_tag.clear();
                } else if c == '>' {
                    inside_tag = false;
                    let tag = current_tag.trim().to_lowercase();
                    if tag.starts_with("br") {
                        lyrics.push('\n');
                    } else if tag.starts_with("div") || tag.starts_with("p") {
                        container_depth += 1;
                        if !lyrics.ends_with('\n') {
                            lyrics.push('\n');
                        }
                    } else if tag == "/div" || tag == "/p" {
                        container_depth -= 1;
                        if container_depth == 0 {
                            break; // End of this container
                        }
                        if !lyrics.ends_with('\n') {
                            lyrics.push('\n');
                        }
                    }
                } else if inside_tag {
                    current_tag.push(c);
                } else {
                    lyrics.push(c);
                }
            }
            lyrics.push('\n');
        }
    }
    
    decode_html_entities(&lyrics)
}

fn decode_html_entities(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&#39;", "'")
        .replace("&nbsp;", " ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_lyrics() {
        let html = r#"<div data-lyrics-container="true">Line 1<br/>Line 2<div>Subdiv text</div>Line 3</div>"#;
        let extracted = extract_genius_lyrics(html);
        assert_eq!(extracted.trim(), "Line 1\nLine 2\nSubdiv text\nLine 3");
    }
}
