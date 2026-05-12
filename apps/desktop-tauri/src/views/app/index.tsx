import { useState, useEffect, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import './app.css'

type UiState = { floating_font_scale: number };

type TrackRef = {
  uri: string;
  title: string;
  artist: string;
  album: string | null;
  duration_ms: number;
  artwork_url: string | null;
};

type LyricsStatus = 'Loading' | 'Ready' | 'NotFound' | { Error: string };

type RenderSnapshot = {
  playback: {
    track: TrackRef | null;
    state: 'Playing' | 'Paused' | 'Stopped';
    position_ms: number | null;
  };
  lyrics_status: LyricsStatus;
  active_line_index: number | null;
};

function applyFloatingFont(scale: number) {
  document.documentElement.style.setProperty('--font-scale', String(scale));
}

function formatMs(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const FALLBACK_ART = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>';
const POLL_MS = 300;

function App() {
  const [lyrics, setLyrics] = useState<string[]>([])
  const [activeLine, setActiveLine] = useState<number | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [track, setTrack] = useState<TrackRef | null>(null)
  const [positionMs, setPositionMs] = useState(0)
  const lyricsRef = useRef<(HTMLDivElement | null)[]>([])
  const lastUriRef = useRef('')
  const refreshedUriRef = useRef('')
  const lyricsLoadedUriRef = useRef('')

  function startWindowDrag(event: React.MouseEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    event.preventDefault()
    void getCurrentWindow().startDragging()
  }

  // Poll render snapshot every 300 ms for real playback + lyrics state.
  useEffect(() => {
    const poll = async () => {
      try {
        const snap = await invoke<RenderSnapshot>('get_render_snapshot');
        const uri = snap.playback.track?.uri ?? '';

        setIsPlaying(snap.playback.state === 'Playing');
        setTrack(snap.playback.track);
        setPositionMs(snap.playback.position_ms ?? 0);
        setActiveLine(snap.active_line_index ?? null);

        // Track changed — clear lyrics so stale lines don't show.
        if (uri !== lastUriRef.current) {
          lastUriRef.current = uri;
          setLyrics([]);
          lyricsLoadedUriRef.current = '';
        }

        // Trigger network fetch once per URI when lyrics are missing.
        if (uri && snap.lyrics_status === 'Loading' && refreshedUriRef.current !== uri) {
          refreshedUriRef.current = uri;
          invoke('refresh_lyrics').catch(() => { });
        }

        // Load all lyric lines once the cache is ready.
        if (uri && snap.lyrics_status === 'Ready' && lyricsLoadedUriRef.current !== uri) {
          lyricsLoadedUriRef.current = uri;
          invoke<string[]>('get_all_lyrics')
            .then(lines => setLyrics(lines))
            .catch(() => { });
        }
      } catch {
        // Ignore transient errors during poll.
      }
    };

    const timer = setInterval(poll, POLL_MS);
    void poll();
    return () => clearInterval(timer);
  }, []);

  // Subscribe to UI settings (font scale).
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      const s = await invoke<UiState>('get_ui_state');
      applyFloatingFont(s.floating_font_scale);
      unlisten = await listen<UiState>('ui-settings-changed', (e) => {
        applyFloatingFont(e.payload.floating_font_scale);
      });
    })();
    return () => unlisten?.();
  }, []);

  // Scroll active lyric into view.
  useEffect(() => {
    if (activeLine !== null && lyricsRef.current[activeLine]) {
      lyricsRef.current[activeLine]?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      })
    }
  }, [activeLine])

  const artworkSrc = track?.artwork_url ?? FALLBACK_ART;
  const durationMs = track?.duration_ms ?? 0;
  const progressPct = durationMs > 0 ? (positionMs / durationMs) * 100 : 0;

  return (
    <main className="lyra-window">
      <div className="drag-region" onMouseDown={startWindowDrag} />

      {/* Glowing Ambient Background (Color Bounce) */}
      <div className="ambient-bg" aria-hidden="true">
        <img src={artworkSrc} alt="" />
        <div className="ambient-dimmer"></div>
      </div>

      {/* Left Column: Player Sidebar */}
      <section className="player-sidebar">

        {/* Large Centered Album Art */}
        <div className="album-art-large">
          <img
            src={artworkSrc}
            alt="Album cover"
            className="album-cover"
            draggable={false}
          />
        </div>

        {/* Bottom Left Controls matched to reference */}
        <div className="player-controls-bottom">
          <div className="track-info">
            <div className="track-meta">
              <h2 className="track-title">{track?.title ?? '—'}</h2>
              <p className="track-artist">{track?.artist ?? '—'}</p>
            </div>
            <div className="track-actions">
              <button className="action-btn" aria-label="Like">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>
              </button>
              <button className="action-btn" aria-label="Options">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /><circle cx="5" cy="12" r="2" /></svg>
              </button>
            </div>
          </div>

          <div className="progress-bar">
            <span className="time-label">{formatMs(positionMs)}</span>
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${progressPct}%` }}></div>
            </div>
            <span className="time-label">{formatMs(durationMs)}</span>
          </div>

          <div className="transport-controls">
            <button className="btn-icon skip" aria-label="Previous">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" /></svg>
            </button>
            <button className="btn-icon play-pause" aria-label={isPlaying ? "Pause" : "Play"}>
              {isPlaying ? (
                <svg width="36" height="36" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg>
              ) : (
                <svg width="36" height="36" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
              )}
            </button>
            <button className="btn-icon skip" aria-label="Next">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" /></svg>
            </button>
          </div>
        </div>
      </section>

      {/* Right Column: Lyrics Pane */}
      <section className="lyrics-pane">
        <div className="lyrics-container">
          {lyrics.map((line, index) => {
            let className = 'lyric-line'
            if (index === activeLine) className += ' active'
            else if (activeLine !== null && index < activeLine) className += ' passed'

            return (
              <div
                key={index}
                ref={(el) => {
                  lyricsRef.current[index] = el
                }}
                className={className}
              >
                {line}
              </div>
            )
          })}
        </div>
      </section>
    </main>
  )
}

export default App
