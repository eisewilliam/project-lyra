import { useState, useEffect, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'

import {
  getNotFoundReason,
  isLyricsNotFound,
  isRetryableNotFound,
  resolveLyricsSurfaceState,
  type LyricsPlaceholderState,
  type LyricsStatus,
  type NotFoundReason,
} from '../../utils/lyrics-state'
import { LyricsPlaceholderIcon } from '../../utils/lyrics-placeholder-icon'
import { applyHostOsDataset } from '../../utils/os'
import { usePageVisible } from '../../utils/use-page-visible'
import './app.css'

applyHostOsDataset();

type UiState = { floating_visible: boolean; floating_font_scale: number };
type AppSettingsSnapshot = { behavior: { hide_when_paused: boolean } };

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

function applySurfaceVisible(visible: boolean) {
  document.documentElement.dataset.surfaceVisible = String(visible);
}

applySurfaceVisible(false);

function syncSurfaceVisible(
  desiredRef: { current: boolean },
  autoHiddenRef: { current: boolean },
  setVisible: (visible: boolean) => void,
  desired?: boolean,
  autoHidden?: boolean,
) {
  if (desired !== undefined) desiredRef.current = desired;
  if (autoHidden !== undefined) autoHiddenRef.current = autoHidden;
  const visible = desiredRef.current && !autoHiddenRef.current;
  setVisible(visible);
  applySurfaceVisible(visible);
  return visible;
}

function sameTrack(a: TrackRef | null, b: TrackRef | null) {
  return a?.uri === b?.uri
    && a?.title === b?.title
    && a?.artist === b?.artist
    && a?.album === b?.album
    && a?.duration_ms === b?.duration_ms
    && a?.artwork_url === b?.artwork_url;
}

function wordsKey(words: LyricWord[] | null | undefined) {
  return (words ?? [])
    .map((word) => `${word.start_ms}:${word.end_ms}:${word.text}`)
    .join('|');
}

function formatMs(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const SURFACE_LABEL = 'main';
const FALLBACK_ART = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>';
const BLEND_MS = 500;
let mainWindowReadyPromise: Promise<void> | null = null;

function ensureMainWindowReady(): Promise<void> {
  if (!mainWindowReadyPromise) {
    mainWindowReadyPromise = invoke('window_ready', { label: SURFACE_LABEL })
      .then(() => undefined)
      .catch((err) => {
        mainWindowReadyPromise = null;
        throw err;
      });
  }
  return mainWindowReadyPromise;
}

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

function WindowControls() {
  const win = getCurrentWindow();
  return (
    <div className="win-controls">
      <button className="win-control-btn" onClick={() => win.minimize()} aria-label="Minimize">
        <svg width="10" height="1" viewBox="0 0 10 1" fill="currentColor"><rect width="10" height="1" /></svg>
      </button>
      <button className="win-control-btn" onClick={() => win.toggleMaximize()} aria-label="Maximize">
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1"><rect x="0.5" y="0.5" width="9" height="9" /></svg>
      </button>
      <button className="win-control-btn close" onClick={() => win.close()} aria-label="Close">
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2"><line x1="0" y1="0" x2="10" y2="10" /><line x1="10" y1="0" x2="0" y2="10" /></svg>
      </button>
    </div>
  );
}

function App() {
  const [lyrics, setLyrics] = useState<LineRef[]>([])
  const [activeLine, setActiveLine] = useState<number | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [track, setTrack] = useState<TrackRef | null>(null)
  const [lyricsStatus, setLyricsStatus] = useState<LyricsStatus>('Loading')
  const [snapshotReady, setSnapshotReady] = useState(false)
  const [positionMs, setPositionMs] = useState(0)
  const [activeLineWords, setActiveLineWords] = useState<LyricWord[]>([])
  const [surfaceVisible, setSurfaceVisible] = useState(false)
  const baselineRef = useRef<PositionBaseline>({ ms: 0, at: 0, targetMs: 0, targetAt: 0, blendDur: 1 })
  const lyricsRef = useRef<(HTMLDivElement | null)[]>([])
  const wordRefs = useRef<(HTMLSpanElement | null)[]>([])
  const progressFillRef = useRef<HTMLDivElement | null>(null)
  const positionLabelRef = useRef<HTMLSpanElement | null>(null)
  const pageVisible = usePageVisible()
  const progressTrackRef = useRef<HTMLDivElement | null>(null)
  const lastUriRef = useRef('')
  const refreshedUriRef = useRef('')
  const lyricsLoadedUriRef = useRef('')
  const activeWordsKeyRef = useRef('')
  const desiredVisibleRef = useRef(true)
  const autoHiddenRef = useRef(false)
  const [hideWhenPaused, setHideWhenPaused] = useState(false)

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

  // Subscribe to backend `playback-tick` events. The backend polls Spotify
  // (adaptive cadence: 250ms playing → 2.5s stopped) and emits a snapshot to
  // every window — frontends used to setInterval-poll which burned ~10 IPC/sec
  // idle and prevented App Nap.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    const apply = (snap: RenderSnapshot) => {
      if (cancelled) return;
      const uri = snap.playback.track?.uri ?? '';
      const uriChanged = uri !== lastUriRef.current;

      if (uriChanged) {
        lastUriRef.current = uri;
        setLyrics([]);
        setActiveLine(null);
        activeWordsKeyRef.current = '';
        setActiveLineWords([]);
        lyricsLoadedUriRef.current = '';
      }

      setSnapshotReady(true);
      const playingNow = snap.playback.state === 'Playing';
      setIsPlaying(playingNow);
      setTrack((prev) => sameTrack(prev, snap.playback.track) ? prev : snap.playback.track);
      setLyricsStatus(snap.lyrics_status);

      // Position sync:
      //  1. Age-correct via observed_at_ms — the backend snapshot may be
      //     up to one poll-interval stale.
      //  2. Lock current interpolated value as new baseline; blend toward
      //     the corrected target over BLEND_MS so the trajectory bends
      //     smoothly instead of jumping.
      //  3. Snap on big drifts (seek, track change, pause/resume).
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
      const nextWords = snap.active_line_words ?? [];
      const nextWordsKey = wordsKey(nextWords);
      if (nextWordsKey !== activeWordsKeyRef.current) {
        activeWordsKeyRef.current = nextWordsKey;
        setActiveLineWords(nextWords);
      }

      if (uri && snap.lyrics_status === 'Loading' && refreshedUriRef.current !== uri) {
        refreshedUriRef.current = uri;
        invoke('refresh_lyrics').catch(() => { });
      }

      if (uri && snap.lyrics_status === 'Ready' && lyricsLoadedUriRef.current !== uri) {
        lyricsLoadedUriRef.current = uri;
        invoke<Array<{ start_ms: number; text: string }>>('get_all_lines')
          .then(lines => setLyrics(lines.map(l => ({ start_ms: l.start_ms, text: l.text }))))
          .catch(() => { });
      }
    };

    (async () => {
      await ensureMainWindowReady();
      try {
        const initial = await invoke<RenderSnapshot>('get_render_snapshot');
        apply(initial);
      } catch { /* transient */ }
      unlisten = await listen<RenderSnapshot>('playback-tick', (e) => apply(e.payload));
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  // Subscribe to UI settings (font scale).
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let unlistenAppSettings: (() => void) | undefined;
    (async () => {
      // Show (or keep hidden) first so WKWebView's evaluateJavaScript
      // callback path is live before any further invoke() calls.
      await ensureMainWindowReady();

      const [s, appSettings] = await Promise.all([
        invoke<UiState>('get_ui_state'),
        invoke<AppSettingsSnapshot>('get_settings'),
      ]);
      setHideWhenPaused(appSettings.behavior.hide_when_paused);
      syncSurfaceVisible(desiredVisibleRef, autoHiddenRef, setSurfaceVisible, s.floating_visible);
      applyFloatingFont(s.floating_font_scale);
      unlisten = await listen<UiState>('ui-settings-changed', (e) => {
        syncSurfaceVisible(
          desiredVisibleRef,
          autoHiddenRef,
          setSurfaceVisible,
          e.payload.floating_visible,
        );
        applyFloatingFont(e.payload.floating_font_scale);
      });
      unlistenAppSettings = await listen<AppSettingsSnapshot>('app-settings-changed', (e) => {
        const enabled = e.payload.behavior.hide_when_paused;
        setHideWhenPaused(enabled);
        if (!enabled) {
          syncSurfaceVisible(desiredVisibleRef, autoHiddenRef, setSurfaceVisible, undefined, false);
        }
      });
    })();
    return () => {
      unlisten?.();
      unlistenAppSettings?.();
    };
  }, []);

  // Auto-hide/show the window when playback state changes, if hide_when_paused is enabled.
  useEffect(() => {
    if (!snapshotReady) return;
    const win = getCurrentWindow();
    if (hideWhenPaused && !isPlaying && desiredVisibleRef.current) {
      syncSurfaceVisible(desiredVisibleRef, autoHiddenRef, setSurfaceVisible, undefined, true);
      void win.hide();
    } else if (autoHiddenRef.current && (!hideWhenPaused || isPlaying)) {
      const visible = syncSurfaceVisible(
        desiredVisibleRef,
        autoHiddenRef,
        setSurfaceVisible,
        undefined,
        false,
      );
      if (visible) {
        void win.show();
      }
    }
  }, [hideWhenPaused, isPlaying, snapshotReady]);

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

  // Interpolate position between backend polls so the progress bar moves
  // smoothly. Directly mutates the progress-fill width and time label via
  // refs — previously this called `setPositionMs` 60 Hz which forced React to
  // reconcile the whole subtree (lyric list included) every frame. Now zero
  // React work in the rAF loop.
  useEffect(() => {
    if (!isPlaying || !pageVisible || !surfaceVisible) return;
    let raf = 0;
    const durationMs = track?.duration_ms ?? 0;
    const tick = () => {
      const pos = interpolatePosition(baselineRef.current, performance.now(), true);
      const fill = progressFillRef.current;
      const label = positionLabelRef.current;
      if (durationMs > 0 && fill) {
        const pct = Math.min(100, Math.max(0, (Math.min(pos, durationMs) / durationMs) * 100)).toFixed(2);
        const nextWidth = `${pct}%`;
        if (fill.style.width !== nextWidth) {
          fill.style.width = nextWidth;
        }
      }
      if (label) {
        const totalSec = Math.floor(pos / 1000);
        const m = Math.floor(totalSec / 60);
        const s = totalSec % 60;
        const nextTime = `${m}:${s.toString().padStart(2, '0')}`;
        if (label.textContent !== nextTime) {
          label.textContent = nextTime;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, pageVisible, surfaceVisible, track?.duration_ms])

  // 60fps word-state updater. Mutates className/CSS var directly on span refs
  // so the React tree is NOT re-rendered every frame.
  //
  // When paused or hidden: position is frozen, so run the loop body once to
  // lock visual state and exit. Avoids a 60Hz no-op while no user can see it.
  useEffect(() => {
    if (activeLineWords.length === 0 || !pageVisible || !surfaceVisible) return;
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
        const progStr = progress.toFixed(3);
        if (el.getAttribute('data-last-prog') !== progStr) {
          el.setAttribute('data-last-prog', progStr);
          el.style.setProperty('--word-progress', progStr);
        }
      }
      if (isPlaying) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [activeLineWords, isPlaying, pageVisible, surfaceVisible])

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
  const notFoundReason = isLyricsNotFound(lyricsStatus)
    ? getNotFoundReason(lyricsStatus)
    : null;
  const canRetry = isRetryableNotFound(lyricsStatus);

  function retryLyrics() {
    refreshedUriRef.current = '';
    invoke('force_refresh_lyrics').catch(() => { });
  }

  return (
    <main className="lyra-window">
      <div className="drag-region" data-tauri-drag-region />
      {isWindows && <WindowControls />}

      {/* Glowing Ambient Background (Color Bounce) */}
      <div className="ambient-bg" aria-hidden="true">
        <img src={artworkSrc} alt="" decoding="async" />
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
            decoding="async"
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
              <button className="track-action-btn" aria-label="Like" disabled={!hasTrack}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>
              </button>
              <button className="track-action-btn" aria-label="Options" disabled={!hasTrack}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /><circle cx="5" cy="12" r="2" /></svg>
              </button>
            </div>
          </div>

          <div className="progress-bar">
            <span className="time-label" ref={positionLabelRef}>{formatMs(clampedPositionMs)}</span>
            <div
              className={`progress-track ${hasTrack ? '' : 'is-placeholder'}`}
              ref={progressTrackRef}
              onClick={seekFromClick}
            >
              <div className="progress-fill" ref={progressFillRef} style={{ width: `${progressPct}%` }}></div>
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
                    line.text || (index === lyrics.length - 1 ? '' : '♪')
                  )}
                </div>
              )
            })}
          </div>
        ) : (
          <LyricsPlaceholder
            state={lyricsViewState}
            notFoundReason={notFoundReason}
            onRetry={canRetry ? retryLyrics : undefined}
          />
        )}
      </section>
    </main>
  )
}

function LyricsPlaceholder({
  state,
  notFoundReason,
  onRetry,
}: {
  state: LyricsPlaceholderState;
  notFoundReason?: NotFoundReason | null;
  onRetry?: () => void;
}) {
  const loading = state === 'booting' || state === 'loading';
  const label = getPlaceholderLabel(state, notFoundReason ?? null);

  return (
    <div className={`lyrics-placeholder is-${state} ${loading ? 'is-loading' : ''}`}>
      <div className="lyrics-placeholder-card" role="status" aria-label={label}>
        <div className="lyrics-placeholder-orb" aria-hidden="true">
          <span className="lyrics-placeholder-ring" />
          <span className="lyrics-placeholder-core">
            <LyricsPlaceholderIcon state={state} className="lyrics-placeholder-icon" />
          </span>
        </div>

        {loading ? (
          <div className="lyrics-placeholder-dots" aria-hidden="true">
            <span className="lyrics-placeholder-dot" />
            <span className="lyrics-placeholder-dot" />
            <span className="lyrics-placeholder-dot" />
          </div>
        ) : (
          <p className="lyrics-placeholder-label">{label}</p>
        )}

        {onRetry ? (
          <button type="button" className="lyrics-placeholder-retry" onClick={onRetry}>
            Retry
          </button>
        ) : null}
      </div>
    </div>
  );
}

function getPlaceholderLabel(
  state: LyricsPlaceholderState,
  notFoundReason: NotFoundReason | null,
) {
  switch (state) {
    case 'booting':
      return 'Connecting to Spotify';
    case 'idle':
      return 'Waiting for playback';
    case 'loading':
      return 'Loading lyrics';
    case 'empty':
      return 'No synced lyrics for this track';
    case 'error':
      switch (notFoundReason) {
        case 'NetworkError':
          return "Couldn't reach lyric server";
        case 'RateLimit':
          return 'Lyric server busy — backing off';
        default:
          return 'Lyrics unavailable';
      }
    default:
      return '';
  }
}

export default App
