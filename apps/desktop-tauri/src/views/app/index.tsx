import { useState, useEffect, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { MOCK_LYRICS, ALBUM_COVER } from '../../constants'
import './app.css'

type UiState = { floating_font_scale: number };

function applyFloatingFont(scale: number) {
  document.documentElement.style.setProperty('--font-scale', String(scale));
}

function App() {
  const [activeLine, setActiveLine] = useState(3)
  const [isPlaying, setIsPlaying] = useState(true)
  const lyricsRef = useRef<(HTMLDivElement | null)[]>([])

  function startWindowDrag(event: React.MouseEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    event.preventDefault()
    void getCurrentWindow().startDragging()
  }

  // Auto-scroll simulation
  useEffect(() => {
    if (!isPlaying) return;
    const timer = setInterval(() => {
      setActiveLine(prev => (prev + 1) % MOCK_LYRICS.length)
    }, 4000)
    return () => clearInterval(timer)
  }, [isPlaying])

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

  // Scroll active lyric into view
  useEffect(() => {
    if (lyricsRef.current[activeLine]) {
      lyricsRef.current[activeLine]?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      })
    }
  }, [activeLine])

  return (
    <main className="lyra-window">
      <div className="drag-region" onMouseDown={startWindowDrag} />

      {/* Glowing Ambient Background (Color Bounce) */}
      <div className="ambient-bg" aria-hidden="true">
        <img src={ALBUM_COVER} alt="" />
        <div className="ambient-dimmer"></div>
      </div>

      {/* Left Column: Player Sidebar */}
      <section className="player-sidebar">

        {/* Large Centered Album Art */}
        <div className="album-art-large">
          <img
            src={ALBUM_COVER}
            alt="Album cover"
            className="album-cover"
            draggable={false}
          />
        </div>

        {/* Bottom Left Controls matched to reference */}
        <div className="player-controls-bottom">
          <div className="track-info">
            <div className="track-meta">
              <h2 className="track-title">Moth To A Flame (with The Weeknd)</h2>
              <p className="track-artist">Swedish House Mafia</p>
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
            <span className="time-label">1:52</span>
            <div className="progress-track">
              <div className="progress-fill" style={{ width: '48%' }}></div>
            </div>
            <span className="time-label">3:54</span>
          </div>

          <div className="transport-controls">
            <button className="btn-icon skip" aria-label="Previous">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" /></svg>
            </button>
            <button className="btn-icon play-pause" aria-label={isPlaying ? "Pause" : "Play"} onClick={() => setIsPlaying(!isPlaying)}>
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
          {MOCK_LYRICS.map((line, index) => {
            let className = 'lyric-line'
            if (index === activeLine) className += ' active'
            else if (index < activeLine) className += ' passed'

            return (
              <div
                key={index}
                ref={(el) => {
                  lyricsRef.current[index] = el
                }}
                className={className}
                onClick={() => setActiveLine(index)}
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
