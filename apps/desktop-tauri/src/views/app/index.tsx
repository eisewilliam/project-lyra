import { memo, useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'

const isWindows = navigator.userAgent.includes('Windows');
document.body.dataset.os = isWindows ? 'windows' : 'macos';
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
import { usePageVisible } from '../../utils/use-page-visible'
import { applyAppearance, type AppSettings } from '../../utils/app-settings'
import {
  BLEND_MS,
  interpolatePosition,
  makeWindowReady,
  syncSurfaceVisible,
  wordsKey,
  applySurfaceVisible,
  type LyricWord,
  type PositionBaseline,
} from '../../utils/playback-sync'
import './app.css'

type UiState = { floating_visible: boolean; floating_font_scale: number };

type TrackRef = {
  uri: string;
  title: string;
  artist: string;
  album: string | null;
  duration_ms: number;
  artwork_url: string | null;
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

applySurfaceVisible(false);

function sameTrack(a: TrackRef | null, b: TrackRef | null) {
  return a?.uri === b?.uri
    && a?.title === b?.title
    && a?.artist === b?.artist
    && a?.album === b?.album
    && a?.duration_ms === b?.duration_ms
    && a?.artwork_url === b?.artwork_url;
}

function formatMs(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const SURFACE_LABEL = 'main';
const FALLBACK_ART = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>';
const ensureMainWindowReady = makeWindowReady(SURFACE_LABEL);

type LineRef = { start_ms: number; text: string };
type LineState = 'active' | 'passed' | 'upcoming';

interface LyricLineProps {
  index: number;
  text: string;
  state: LineState;
  words: LyricWord[] | null;
  isLastEmpty: boolean;
  onSeek: (index: number, ts: number) => void;
  lyricsRef: MutableRefObject<(HTMLDivElement | null)[]>;
  wordRefs: MutableRefObject<(HTMLSpanElement | null)[]>;
}

// React.memo so non-active lines don't reconcile on every active-line change.
// Only the previous-active and new-active lines re-render per transition.
const LyricLine = memo(function LyricLine({
  index,
  text,
  state,
  words,
  isLastEmpty,
  onSeek,
  lyricsRef,
  wordRefs,
}: LyricLineProps) {
  const className =
    state === 'active' ? 'lyric-line active'
    : state === 'passed' ? 'lyric-line passed'
    : 'lyric-line';
  return (
    <div
      ref={(el) => { lyricsRef.current[index] = el; }}
      className={className}
      onClick={(event) => onSeek(index, event.timeStamp)}
      role="button"
      tabIndex={0}
      title="Click to seek here"
    >
      {words ? (
        words.map((w, wi) => (
          <span
            key={wi}
            ref={(el) => { wordRefs.current[wi] = el; }}
            className="lyric-word upcoming"
          >{w.text}</span>
        ))
      ) : (
        text || (isLastEmpty ? '' : '♪')
      )}
    </div>
  );
});

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
  const lyricsPaneRef = useRef<HTMLElement | null>(null)
  const lyricsContainerRef = useRef<HTMLDivElement | null>(null)
  const reelUriRef = useRef('')
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
  const [hideWhenIdle, setHideWhenIdle] = useState(false)
  const [karaokeMode, setKaraokeMode] = useState(false)
  const [lyricOffsetMs, setLyricOffsetMs] = useState(0)
  const [menuOpen, setMenuOpen] = useState(false)
  const offsetUriRef = useRef('')

  // Stable so memoized LyricLine children don't re-render on every parent tick.
  const lyricsRefForCb = useRef<LineRef[]>(lyrics);
  useEffect(() => {
    lyricsRefForCb.current = lyrics;
  }, [lyrics]);
  const seekToLine = useCallback((index: number, eventTimeStamp: number) => {
    const target = lyricsRefForCb.current[index]?.start_ms;
    if (target === undefined) return;
    const now = eventTimeStamp;
    // Optimistic UI: snap position + active line immediately so click feels
    // instant. Backend catches up on the next poll.
    baselineRef.current = { ms: target, at: now, targetMs: target, targetAt: now, blendDur: 1 };
    setPositionMs(target);
    setActiveLine(index);
    setActiveLineWords([]);
    invoke('playback_seek_ms', { positionMs: target }).catch(() => { });
  }, []);

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
        lyricsRef.current = [];
        wordRefs.current = [];
        // Pull the persisted lyric offset for the new track so the quick menu
        // shows the stored value (the backend already applies it to sync).
        if (uri && offsetUriRef.current !== uri) {
          offsetUriRef.current = uri;
          invoke<number>('get_lyric_offset')
            .then((ms) => setLyricOffsetMs(ms))
            .catch(() => setLyricOffsetMs(0));
        } else if (!uri) {
          offsetUriRef.current = '';
          setLyricOffsetMs(0);
        }
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
        invoke<AppSettings>('get_settings'),
      ]);
      setHideWhenPaused(appSettings.behavior.hide_when_paused);
      setHideWhenIdle(appSettings.window.hide_when_idle);
      setKaraokeMode(appSettings.behavior.karaoke_mode);
      applyAppearance(appSettings.appearance);
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
      unlistenAppSettings = await listen<AppSettings>('app-settings-changed', (e) => {
        const enabled = e.payload.behavior.hide_when_paused;
        setHideWhenPaused(enabled);
        setHideWhenIdle(e.payload.window.hide_when_idle);
        setKaraokeMode(e.payload.behavior.karaoke_mode);
        applyAppearance(e.payload.appearance);
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

  // Auto-hide/show the window when playback state changes:
  //  - hide_when_paused → hide while not playing
  //  - hide_when_idle   → hide when there's no track at all (Spotify idle)
  useEffect(() => {
    if (!snapshotReady) return;
    const win = getCurrentWindow();
    const idle = !track;
    const shouldAutoHide = (hideWhenPaused && !isPlaying) || (hideWhenIdle && idle);
    if (shouldAutoHide && desiredVisibleRef.current) {
      syncSurfaceVisible(desiredVisibleRef, autoHiddenRef, setSurfaceVisible, undefined, true);
      void win.hide();
    } else if (autoHiddenRef.current && !shouldAutoHide) {
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
  }, [hideWhenPaused, hideWhenIdle, isPlaying, track, snapshotReady]);

  // Smooth-scroll the active lyric to vertical center using a single rAF after
  // layout settles. scrollIntoView with smooth behavior provides hardware-accel
  // scrolling without re-running on every poll.
  // Reel: centre the active line by translating the whole lyrics column with a
  // long eased CSS transition, instead of native smooth-scroll (which lands as
  // an abrupt jump). On a song change we snap (no transition) so we don't slide
  // across from the previous track's offset. Reduced-motion → snap, no glide.
  useEffect(() => {
    const pane = lyricsPaneRef.current;
    const container = lyricsContainerRef.current;
    if (!pane || !container) return;

    const uri = track?.uri ?? '';
    const songChanged = uri !== reelUriRef.current;
    reelUriRef.current = uri;

    // Karaoke mode centres via CSS (only active+next shown) — no reel offset.
    if (karaokeMode || activeLine === null) {
      container.style.transform = 'translateY(0)';
      return;
    }

    const el = lyricsRef.current[activeLine];
    if (!el) return;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const raf = requestAnimationFrame(() => {
      // Layout values (offsetTop/clientHeight) are independent of the current
      // transform, so this absolute target never drifts.
      const target = pane.clientHeight / 2
        - container.offsetTop
        - el.offsetTop
        - el.offsetHeight / 2;
      const noGlide = reduceMotion || songChanged;
      container.style.transition = noGlide ? 'none' : '';
      container.style.transform = `translateY(${target}px)`;
      if (noGlide) {
        // Restore the glide for subsequent in-song line changes.
        void container.offsetHeight;
        container.style.transition = '';
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [activeLine, karaokeMode, track?.uri, lyrics.length])

  // Combined per-frame loop: progress bar + word karaoke colouring share one
  // rAF instead of two. Cuts callback count in half and lets both consumers
  // reuse a single `interpolatePosition()` result per frame.
  //
  // DOM-write gates use JS-side caches (lastWordCls / lastWordProgQ) — the
  // previous version called `el.className` / `el.getAttribute(...)` every
  // frame, both of which trigger style-system reads inside WebKit. Avoiding
  // them keeps the loop free of forced style-recalc.
  //
  // When paused or hidden: position is frozen, so run the loop body once to
  // lock visual state and exit. No 60 Hz no-op while no user can see it.
  useEffect(() => {
    if (!pageVisible || !surfaceVisible) return;
    if (!isPlaying && activeLineWords.length === 0) {
      // Nothing to animate (no words, paused, hidden) — also bail on the
      // progress-bar loop since nothing moves while paused.
      return;
    }
    let raf = 0;
    const durationMs = track?.duration_ms ?? 0;
    let lastProgWidth = '';
    let lastTimeLabel = '';
    const lastWordCls: string[] = new Array(activeLineWords.length).fill('');
    const lastWordProgQ: number[] = new Array(activeLineWords.length).fill(-1);
    const tick = () => {
      const pos = interpolatePosition(baselineRef.current, performance.now(), isPlaying);

      // Progress bar + time label (only while playing — otherwise frozen).
      if (isPlaying) {
        const fill = progressFillRef.current;
        const label = positionLabelRef.current;
        if (durationMs > 0 && fill) {
          const pct = Math.min(100, Math.max(0, (Math.min(pos, durationMs) / durationMs) * 100)).toFixed(2);
          const nextWidth = `${pct}%`;
          if (nextWidth !== lastProgWidth) {
            lastProgWidth = nextWidth;
            fill.style.width = nextWidth;
          }
        }
        if (label) {
          const totalSec = Math.floor(pos / 1000);
          const m = Math.floor(totalSec / 60);
          const s = totalSec % 60;
          const nextTime = `${m}:${s.toString().padStart(2, '0')}`;
          if (nextTime !== lastTimeLabel) {
            lastTimeLabel = nextTime;
            label.textContent = nextTime;
          }
        }
      }

      // Word colouring — runs once when paused to lock the final state.
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
        if (cls !== lastWordCls[i]) {
          lastWordCls[i] = cls;
          el.className = cls;
        }
        // Quantize to 0.001 buckets — same 3-decimal precision as before, but
        // the comparison stays in JS (Int) instead of round-tripping a string
        // attribute through the DOM. No visual difference.
        const progQ = (progress * 1000) | 0;
        if (progQ !== lastWordProgQ[i]) {
          lastWordProgQ[i] = progQ;
          el.style.setProperty('--word-progress', (progQ / 1000).toString());
        }
      }
      if (isPlaying) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [activeLineWords, isPlaying, pageVisible, surfaceVisible, track?.duration_ms])

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

  // Per-track lyric timing offset (the quick-menu "Delay lyrics" control).
  // Positive = lyrics later, negative = earlier. The backend persists per URI
  // and re-broadcasts a snapshot, so the visible sync updates immediately.
  function nudgeOffset(deltaMs: number) {
    invoke<number>('nudge_lyric_offset', { deltaMs })
      .then((ms) => setLyricOffsetMs(ms))
      .catch(() => { });
  }
  function resetOffset() {
    invoke<number>('set_lyric_offset', { offsetMs: 0 })
      .then((ms) => setLyricOffsetMs(ms))
      .catch(() => { });
  }
  const offsetLabel = `${lyricOffsetMs > 0 ? '+' : ''}${lyricOffsetMs} ms`;

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
              <div className="track-menu">
                <button
                  className={`track-action-btn ${menuOpen ? 'active' : ''}`}
                  aria-label="Options"
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  disabled={!hasTrack}
                  onClick={() => setMenuOpen((o) => !o)}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /><circle cx="5" cy="12" r="2" /></svg>
                </button>
                {menuOpen && (
                  <>
                    <div className="track-menu-backdrop" onClick={() => setMenuOpen(false)} />
                    <div className="track-menu-popover" role="menu">
                      <div className="track-menu-section">
                        <span className="track-menu-title">Delay lyrics</span>
                        <div className="offset-control">
                          <button
                            type="button"
                            className="offset-btn"
                            aria-label="Lyrics earlier"
                            onClick={() => nudgeOffset(-100)}
                          >−</button>
                          <span className="offset-value">{offsetLabel}</span>
                          <button
                            type="button"
                            className="offset-btn"
                            aria-label="Lyrics later"
                            onClick={() => nudgeOffset(100)}
                          >+</button>
                        </div>
                        <button
                          type="button"
                          className="track-menu-reset"
                          onClick={resetOffset}
                          disabled={lyricOffsetMs === 0}
                        >Reset to 0</button>
                      </div>
                      <button
                        type="button"
                        className="track-menu-item"
                        onClick={() => { retryLyrics(); setMenuOpen(false); }}
                      >Refresh lyrics</button>
                    </div>
                  </>
                )}
              </div>
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
      <section
        className={`lyrics-pane ${lyricsViewState !== 'ready' ? 'is-placeholder' : ''}`}
        ref={lyricsPaneRef}
      >
        {lyricsViewState === 'ready' ? (
          <div
            className={`lyrics-container ${karaokeMode ? 'is-karaoke' : ''}`}
            ref={lyricsContainerRef}
          >
            {lyrics.map((line, index) => {
              const lineState: LineState =
                index === activeLine ? 'active'
                : (activeLine !== null && index < activeLine) ? 'passed'
                : 'upcoming';
              const isActive = index === activeLine;
              const words = isActive && activeLineWords.length > 0 ? activeLineWords : null;
              return (
                <LyricLine
                  key={index}
                  index={index}
                  text={line.text}
                  state={lineState}
                  words={words}
                  isLastEmpty={index === lyrics.length - 1}
                  onSeek={seekToLine}
                  lyricsRef={lyricsRef}
                  wordRefs={wordRefs}
                />
              );
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
