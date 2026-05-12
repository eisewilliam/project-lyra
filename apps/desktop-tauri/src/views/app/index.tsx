import { useState, useEffect, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import {
  resolveLyricsSurfaceState,
  type LyricsPlaceholderState,
  type LyricsStatus,
} from '../../utils/lyrics-state'
import { LyricsPlaceholderIcon } from '../../utils/lyrics-placeholder-icon'
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

type LyricWord = {
  start_ms: number;
  end_ms: number;
  text: string;
};

type RenderSnapshot = {
  playback: {
    track: TrackRef | null;
    state: 'Playing' | 'Paused' | 'Stopped';
    position_ms: number | null;
    /// Backend wall-clock ms (Unix epoch) when this snapshot was sampled —
    /// used to age-correct the position value on the frontend.
    observed_at_ms: number;
  };
  lyrics_status: LyricsStatus;
  active_line_index: number | null;
  active_line_words: LyricWord[] | null;
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
const BLEND_MS = 500;

type PositionBaseline = {
  ms: number;
  at: number;
  targetMs: number;
  targetAt: number;
  blendDur: number;
};

// Interpolate playback position with continuous blending between the previous
// trajectory and a new target. Avoids discrete per-poll jumps that would
// otherwise show up as visible jitter in the karaoke wipe. When paused,
// freezes at the baseline value (which was snapped to the paused position).
function interpolatePosition(b: PositionBaseline, now: number, playing: boolean): number {
  if (!playing) return b.ms;
  const currentTraj = b.ms + (now - b.at);
  const targetTraj = b.targetMs + (now - b.targetAt);
  const elapsed = now - b.at;
  if (elapsed >= b.blendDur) return targetTraj;
  const t = elapsed / Math.max(1, b.blendDur);
  return currentTraj * (1 - t) + targetTraj * t;
}

type LineRef = { start_ms: number; text: string };

function App() {
  const [lyrics, setLyrics] = useState<LineRef[]>([])
  const [activeLine, setActiveLine] = useState<number | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [track, setTrack] = useState<TrackRef | null>(null)
  const [lyricsStatus, setLyricsStatus] = useState<LyricsStatus>('Loading')
  const [snapshotReady, setSnapshotReady] = useState(false)
  const [positionMs, setPositionMs] = useState(0)
  const [activeLineWords, setActiveLineWords] = useState<LyricWord[]>([])
  const baselineRef = useRef<PositionBaseline>({ ms: 0, at: 0, targetMs: 0, targetAt: 0, blendDur: 1 })
  const lyricsRef = useRef<(HTMLDivElement | null)[]>([])
  const wordRefs = useRef<(HTMLSpanElement | null)[]>([])
  const progressTrackRef = useRef<HTMLDivElement | null>(null)
  const lastUriRef = useRef('')
  const refreshedUriRef = useRef('')
  const lyricsLoadedUriRef = useRef('')

  function startWindowDrag(event: React.MouseEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    event.preventDefault()
    void getCurrentWindow().startDragging()
  }

  function seekToLine(index: number, eventTimeStamp: number) {
    const target = lyrics[index]?.start_ms;
    if (target === undefined) return;
    const now = eventTimeStamp;
    // Optimistic UI: snap position + active line immediately so click feels
    // instant. Backend catches up on the next poll.
    baselineRef.current = { ms: target, at: now, targetMs: target, targetAt: now, blendDur: 1 };
    setPositionMs(target);
    setActiveLine(index);
    setActiveLineWords([]);
    invoke('playback_seek_ms', { positionMs: target }).catch(() => { });
  }

  function seekFromClick(event: React.MouseEvent<HTMLDivElement>) {
    if (!progressTrackRef.current || !track || track.duration_ms === 0) return
    const rect = progressTrackRef.current.getBoundingClientRect()
    const pct = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
    const targetMs = Math.floor(pct * track.duration_ms)
    setPositionMs(targetMs)
    const now = performance.now()
    baselineRef.current = { ms: targetMs, at: now, targetMs, targetAt: now, blendDur: 1 }
    invoke('playback_seek_ms', { positionMs: targetMs }).catch(() => { })
  }

  // Poll render snapshot every 300 ms for real playback + lyrics state.
  useEffect(() => {
    const poll = async () => {
      try {
        const snap = await invoke<RenderSnapshot>('get_render_snapshot');
        const uri = snap.playback.track?.uri ?? '';

        setSnapshotReady(true);
        const playingNow = snap.playback.state === 'Playing';
        setIsPlaying(playingNow);
        setTrack(snap.playback.track);
        setLyricsStatus(snap.lyrics_status);

        // Position sync:
        //  1. Age-correct the backend value using observed_at_ms — the snapshot
        //     may be up to 500ms stale (background thread polls every 500ms).
        //     Adding (Date.now() - observed_at_ms) projects to "now".
        //  2. Lock current interpolated value as new baseline; aim toward the
        //     corrected target with a 500ms continuous blend. Each rAF tick
        //     reads via `interpolatePosition` so the trajectory bends smoothly
        //     instead of jumping at poll boundaries.
        //  3. Snap immediately on big drifts (seek, track change, pause/resume).
        const newPos = snap.playback.position_ms ?? 0;
        const now = performance.now();
        const ageMs = playingNow
          ? Math.max(0, Math.min(2000, Date.now() - snap.playback.observed_at_ms))
          : 0;
        const correctedPos = newPos + ageMs;
        const currentInterp = interpolatePosition(baselineRef.current, now, playingNow);
        const drift = correctedPos - currentInterp;

        if (!playingNow || Math.abs(drift) > 1000) {
          baselineRef.current = { ms: correctedPos, at: now, targetMs: correctedPos, targetAt: now, blendDur: 1 };
          setPositionMs(correctedPos);
        } else {
          baselineRef.current = { ms: currentInterp, at: now, targetMs: correctedPos, targetAt: now, blendDur: BLEND_MS };
        }

        setActiveLine(snap.active_line_index ?? null);
        setActiveLineWords(snap.active_line_words ?? []);

        // Track changed — clear lyrics so stale lines don't show.
        if (uri !== lastUriRef.current) {
          lastUriRef.current = uri;
          setLyrics([]);
          setActiveLine(null);
          setActiveLineWords([]);
          lyricsLoadedUriRef.current = '';
        }

        // Trigger network fetch once per URI when lyrics are missing.
        if (uri && snap.lyrics_status === 'Loading' && refreshedUriRef.current !== uri) {
          refreshedUriRef.current = uri;
          invoke('refresh_lyrics').catch(() => { });
        }

        // Load all lyric lines (with timestamps) once the cache is ready.
        if (uri && snap.lyrics_status === 'Ready' && lyricsLoadedUriRef.current !== uri) {
          lyricsLoadedUriRef.current = uri;
          invoke<Array<{ start_ms: number; text: string }>>('get_all_lines')
            .then(lines => setLyrics(lines.map(l => ({ start_ms: l.start_ms, text: l.text }))))
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

  // Smooth-scroll the active lyric to vertical center using a single rAF after
  // layout settles. scrollIntoView with smooth behavior provides hardware-accel
  // scrolling without re-running on every poll.
  useEffect(() => {
    if (activeLine === null) return;
    const el = lyricsRef.current[activeLine];
    if (!el) return;
    const raf = requestAnimationFrame(() => {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    return () => cancelAnimationFrame(raf);
  }, [activeLine])

  // Interpolate position between backend polls so the progress bar moves smoothly.
  useEffect(() => {
    if (!isPlaying) return;
    let raf = 0;
    const tick = () => {
      setPositionMs(interpolatePosition(baselineRef.current, performance.now(), true));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying])

  // 60fps word-state updater. Mutates className/CSS var directly on span refs
  // so the React tree is NOT re-rendered every frame.
  useEffect(() => {
    if (activeLineWords.length === 0) return;
    let raf = 0;
    const tick = () => {
      const pos = interpolatePosition(baselineRef.current, performance.now(), isPlaying);
      for (let i = 0; i < activeLineWords.length; i++) {
        const w = activeLineWords[i];
        const el = wordRefs.current[i];
        if (!el) continue;
        let cls: string;
        let progress: number;
        if (pos >= w.end_ms) {
          cls = 'lyric-word passed';
          progress = 1;
        } else if (pos >= w.start_ms) {
          cls = 'lyric-word singing';
          progress = Math.max(0, Math.min(1, (pos - w.start_ms) / Math.max(1, w.end_ms - w.start_ms)));
        } else {
          cls = 'lyric-word upcoming';
          progress = 0;
        }
        if (el.className !== cls) el.className = cls;
        el.style.setProperty('--word-progress', progress.toFixed(3));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [activeLineWords, isPlaying])

  const artworkSrc = track?.artwork_url ?? FALLBACK_ART;
  const hasTrack = Boolean(track);
  const hasArtwork = Boolean(track?.artwork_url);
  const durationMs = track?.duration_ms ?? 0;
  const clampedPositionMs = durationMs > 0 ? Math.min(positionMs, durationMs) : positionMs;
  const progressPct = durationMs > 0 ? Math.min(100, Math.max(0, (clampedPositionMs / durationMs) * 100)) : 0;
  const lyricsViewState = resolveLyricsSurfaceState({
    booted: snapshotReady,
    hasTrack,
    lyricsStatus,
    hasContent: lyrics.length > 0,
  });

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
            alt={hasTrack ? 'Album cover' : ''}
            className={`album-cover ${hasArtwork ? '' : 'placeholder'}`}
            draggable={false}
          />
        </div>

        {/* Bottom Left Controls matched to reference */}
        <div className="player-controls-bottom">
          <div className={`track-info ${hasTrack ? '' : 'is-placeholder'} ${snapshotReady ? '' : 'is-loading'}`}>
            <div className="track-meta">
              {hasTrack ? (
                <>
                  <h2 className="track-title">{track?.title}</h2>
                  <p className="track-artist">{track?.artist}</p>
                </>
              ) : (
                <div className="track-meta-skeleton" aria-hidden="true">
                  <span className="track-skeleton-line title" />
                  <span className="track-skeleton-line artist" />
                </div>
              )}
            </div>
            <div className="track-actions">
              <button className="action-btn" aria-label="Like" disabled={!hasTrack}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>
              </button>
              <button className="action-btn" aria-label="Options" disabled={!hasTrack}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /><circle cx="5" cy="12" r="2" /></svg>
              </button>
            </div>
          </div>

          <div className="progress-bar">
            <span className="time-label">{formatMs(clampedPositionMs)}</span>
            <div
              className={`progress-track ${hasTrack ? '' : 'is-placeholder'}`}
              ref={progressTrackRef}
              onClick={seekFromClick}
            >
              <div className="progress-fill" style={{ width: `${progressPct}%` }}></div>
            </div>
            <span className="time-label">{formatMs(durationMs)}</span>
          </div>

          <div className="transport-controls">
            <button
              className="btn-icon skip"
              aria-label="Previous"
              onClick={() => invoke('playback_previous').catch(() => { })}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" /></svg>
            </button>
            <button
              className="btn-icon play-pause"
              aria-label={isPlaying ? "Pause" : "Play"}
              onClick={() => {
                setIsPlaying(p => !p);
                invoke('playback_play_pause').catch(() => { });
              }}
            >
              {isPlaying ? (
                <svg width="36" height="36" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg>
              ) : (
                <svg width="36" height="36" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
              )}
            </button>
            <button
              className="btn-icon skip"
              aria-label="Next"
              onClick={() => invoke('playback_next').catch(() => { })}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" /></svg>
            </button>
          </div>
        </div>
      </section>

      {/* Right Column: Lyrics Pane */}
      <section className={`lyrics-pane ${lyricsViewState !== 'ready' ? 'is-placeholder' : ''}`}>
        {lyricsViewState === 'ready' ? (
          <div className="lyrics-container">
            {lyrics.map((line, index) => {
              let className = 'lyric-line'
              if (index === activeLine) className += ' active'
              else if (activeLine !== null && index < activeLine) className += ' passed'

              const isActive = index === activeLine;
              const showWords = isActive && activeLineWords.length > 0;

              return (
                <div
                  key={index}
                  ref={(el) => {
                    lyricsRef.current[index] = el
                  }}
                  className={className}
                  onClick={(event) => seekToLine(index, event.timeStamp)}
                  role="button"
                  tabIndex={0}
                  title="Click to seek here"
                >
                  {showWords ? (
                    activeLineWords.map((w, wi) => (
                      <span
                        key={wi}
                        ref={(el) => { wordRefs.current[wi] = el; }}
                        className="lyric-word upcoming"
                      >{w.text}</span>
                    ))
                  ) : (
                    line.text
                  )}
                </div>
              )
            })}
          </div>
        ) : (
          <LyricsPlaceholder state={lyricsViewState} />
        )}
      </section>
    </main>
  )
}

function LyricsPlaceholder({
  state,
}: {
  state: LyricsPlaceholderState;
}) {
  const loading = state === 'booting' || state === 'loading';
  const skeletonWidths = state === 'idle'
    ? ['40%', '58%', '34%']
    : state === 'empty'
      ? ['54%', '38%', '42%']
      : state === 'error'
        ? ['46%', '33%', '38%']
        : ['82%', '96%', '74%', '88%'];

  return (
    <div className={`lyrics-placeholder is-${state} ${loading ? 'is-loading' : ''}`}>
      <div className="lyrics-placeholder-card" role="status" aria-label={getPlaceholderLabel(state)}>
        <div className="lyrics-placeholder-orb" aria-hidden="true">
          <span className="lyrics-placeholder-ring" />
          <span className="lyrics-placeholder-core">
            <LyricsPlaceholderIcon state={state} className="lyrics-placeholder-icon" />
          </span>
        </div>

        <div className="lyrics-skeleton" aria-hidden="true">
          {skeletonWidths.map((width, index) => (
            <span
              key={`${state}-${width}`}
              className="lyrics-skeleton-line"
              style={{ width, animationDelay: `${index * 120}ms` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function getPlaceholderLabel(state: LyricsPlaceholderState) {
  switch (state) {
    case 'booting':
      return 'Connecting to Spotify';
    case 'idle':
      return 'Waiting for playback';
    case 'loading':
      return 'Loading lyrics';
    case 'empty':
      return 'No synced lyrics';
    case 'error':
      return 'Lyrics unavailable';
    default:
      return '';
  }
}

export default App
