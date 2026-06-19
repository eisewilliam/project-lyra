import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { getCurrentWindow, currentMonitor } from '@tauri-apps/api/window';
import { PhysicalSize } from '@tauri-apps/api/dpi';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  isLyricsError,
  isLyricsNotFound,
  resolveLyricsSurfaceState,
  type LyricsPlaceholderState,
  type LyricsStatus,
} from '../../utils/lyrics-state';
import { LyricsPlaceholderIcon } from '../../utils/lyrics-placeholder-icon';
import { usePageVisible } from '../../utils/use-page-visible';
import { applyAppearance, type AppSettings } from '../../utils/app-settings';
import {
  BLEND_MS,
  interpolatePosition,
  makeWindowReady,
  syncSurfaceVisible,
  applySurfaceVisible,
  wordsKey,
  runWordColouring,
  type LyricWord,
  type PositionBaseline,
} from '../../utils/playback-sync';
import './island.css';

type UiState = {
  island_visible: boolean;
  floating_visible: boolean;
  karaoke_visible: boolean;
  island_locked: boolean;
  island_pos: [number, number] | null;
  island_width: number | null;
  island_height: number | null;
  island_font_scale: number;
  karaoke_font_scale: number;
  floating_font_scale: number;
  island_show_cover: boolean;
  island_cover_circle: boolean;
  island_cover_spin: boolean;
};

type VisibleLine = { index: number; text: string; is_active: boolean };

type RenderSnapshot = {
  playback: {
    track: { uri: string; title: string; artist: string; artwork_url: string | null } | null;
    state: 'Playing' | 'Paused' | 'Stopped';
    position_ms: number | null;
    observed_at_ms: number;
  };
  lyrics_status: LyricsStatus;
  line_progress: number | null;
  visible_lines: VisibleLine[];
  active_line_words: LyricWord[] | null;
};

const TOP_DOCK_SNAP_PX = 80;
const SURFACE_LABEL = 'island';
const FALLBACK_ART = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>';
const ensureIslandWindowReady = makeWindowReady(SURFACE_LABEL);

function applyIslandFont(scale: number) {
  document.documentElement.style.setProperty('--font-scale', String(scale));
}

applySurfaceVisible(false);

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function snapToTopEdge(value: number, topEdge: number) {
  return value <= topEdge + TOP_DOCK_SNAP_PX ? topEdge : value;
}

async function setIslandPanelPosition(x: number, y: number) {
  await invoke('set_overlay_position', { label: SURFACE_LABEL, x, y });
}

export default function Island() {
  const [activeLine, setActiveLine] = useState<string | null>(null);
  const [nextLine, setNextLine] = useState<string | null>(null);
  const [artworkUrl, setArtworkUrl] = useState<string | null>(null);
  const [trackTitle, setTrackTitle] = useState('');
  const [trackArtist, setTrackArtist] = useState('');
  const [hasTrack, setHasTrack] = useState(false);
  const [hasVisibleLyrics, setHasVisibleLyrics] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [lyricsStatus, setLyricsStatus] = useState<LyricsStatus>('Loading');
  const [snapshotReady, setSnapshotReady] = useState(false);
  const [locked, setLocked] = useState(true);
  const [isDocked, setIsDocked] = useState(true);
  const [hasActiveLyric, setHasActiveLyric] = useState(false);
  const [activeLineWords, setActiveLineWords] = useState<LyricWord[]>([]);
  const [activeLineProgress, setActiveLineProgress] = useState(0);
  const [showCover, setShowCover] = useState(true);
  const [coverCircle, setCoverCircle] = useState(false);
  const [coverSpin, setCoverSpin] = useState(false);
  const [surfaceVisible, setSurfaceVisible] = useState(false);
  const saveTimerRef = useRef<number | null>(null);
  const refreshedUriRef = useRef('');
  const lastUriRef = useRef('');
  const activeWordsKeyRef = useRef('');
  const baselineRef = useRef<PositionBaseline>({ ms: 0, at: 0, targetMs: 0, targetAt: 0, blendDur: 1 });
  const wordRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const pageVisible = usePageVisible();
  const desiredVisibleRef = useRef(true);
  const autoHiddenRef = useRef(false);
  const [hideWhenPaused, setHideWhenPaused] = useState(false);
  const [hideWhenIdle, setHideWhenIdle] = useState(false);

  // Init: read persisted state, position window, subscribe to lock + settings changes.
  useEffect(() => {
    let unlistenLock: (() => void) | undefined;
    let unlistenMove: (() => void) | undefined;
    let unlistenSettings: (() => void) | undefined;
    let unlistenAppSettings: (() => void) | undefined;

    (async () => {
      // Show (or keep hidden) immediately so WKWebView's evaluateJavaScript
      // callback path is live before we make any further invoke() calls.
      // A hidden WebView queues evaluateJavaScript until shown — if we wait
      // until after other IPC calls, their responses are never delivered.
      await ensureIslandWindowReady();

      const win = getCurrentWindow();
      const [state, appSettings] = await Promise.all([
        invoke<UiState>('get_ui_state'),
        invoke<AppSettings>('get_settings'),
      ]);
      setHideWhenPaused(appSettings.behavior.hide_when_paused);
      setHideWhenIdle(appSettings.window.hide_when_idle);
      applyAppearance(appSettings.appearance);
      syncSurfaceVisible(desiredVisibleRef, autoHiddenRef, setSurfaceVisible, state.island_visible);
      setLocked(state.island_locked);
      setShowCover(state.island_show_cover ?? true);
      setCoverCircle(state.island_cover_circle ?? false);
      setCoverSpin(state.island_cover_spin ?? false);
      applyIslandFont(state.island_font_scale);

      try {
        const monitor = await currentMonitor();
        const size = await win.outerSize();

        if (monitor) {
          const minX = monitor.position.x;
          const maxX = monitor.position.x + monitor.size.width - size.width;
          const minY = monitor.position.y;
          const maxY = monitor.position.y + monitor.size.height - size.height;

          const [rawX, rawY] = state.island_pos ?? [
            Math.round(monitor.position.x + (monitor.size.width - size.width) / 2),
            minY,
          ];

          const x = clamp(rawX, minX, Math.max(minX, maxX));
          const y = clamp(snapToTopEdge(rawY, minY), minY, Math.max(minY, maxY));

          setIsDocked(y <= minY + 1);
          await setIslandPanelPosition(x, y);
        }
      } catch (e) {
        console.error(e);
      }

      unlistenLock = await listen<boolean>('island-lock-changed', (e) => {
        setLocked(e.payload);
      });

      unlistenSettings = await listen<UiState>('ui-settings-changed', (e) => {
        syncSurfaceVisible(
          desiredVisibleRef,
          autoHiddenRef,
          setSurfaceVisible,
          e.payload.island_visible,
        );
        setLocked(e.payload.island_locked);
        setShowCover(e.payload.island_show_cover ?? true);
        setCoverCircle(e.payload.island_cover_circle ?? false);
        setCoverSpin(e.payload.island_cover_spin ?? false);
        applyIslandFont(e.payload.island_font_scale);
        if (e.payload.island_width && e.payload.island_height) {
          getCurrentWindow().setSize(
            new PhysicalSize(e.payload.island_width, e.payload.island_height)
          ).catch(() => { });
        }
      });
      unlistenAppSettings = await listen<AppSettings>('app-settings-changed', (e) => {
        const enabled = e.payload.behavior.hide_when_paused;
        const idleEnabled = e.payload.window.hide_when_idle;
        setHideWhenPaused(enabled);
        setHideWhenIdle(idleEnabled);
        applyAppearance(e.payload.appearance);
        if (!enabled && !idleEnabled) {
          syncSurfaceVisible(desiredVisibleRef, autoHiddenRef, setSurfaceVisible, undefined, false);
        }
      });

      unlistenMove = await win.onMoved(({ payload }) => {
        currentMonitor().then((monitor) => {
          if (!monitor) {
            return;
          }

          const snappedY = snapToTopEdge(payload.y, monitor.position.y);
          setIsDocked(snappedY <= monitor.position.y + 1);

          if (snappedY !== payload.y) {
            void setIslandPanelPosition(payload.x, snappedY).catch(() => { });
          }

          if (saveTimerRef.current) {
            window.clearTimeout(saveTimerRef.current);
          }
          saveTimerRef.current = window.setTimeout(() => {
            invoke('save_island_position', { x: payload.x, y: snappedY }).catch(() => { });
          }, 250);
        }).catch(() => { });
      });

    })();

    return () => {
      unlistenLock?.();
      unlistenMove?.();
      unlistenSettings?.();
      unlistenAppSettings?.();
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    };
  }, []);

  // Auto-hide/show the window: hide while paused (hide_when_paused) or while
  // there's no track at all (hide_when_idle).
  useEffect(() => {
    if (!snapshotReady) return;
    const win = getCurrentWindow();
    const idle = !hasTrack;
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
  }, [hideWhenPaused, hideWhenIdle, isPlaying, hasTrack, snapshotReady]);

  // Subscribe to backend `playback-tick` events. See app view for rationale.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    const apply = (snap: RenderSnapshot) => {
      if (cancelled) return;
      const track = snap.playback.track;
      const uri = track?.uri ?? '';
      const uriChanged = uri !== lastUriRef.current;
      const activeIdx = snap.visible_lines.findIndex((line) => line.is_active);
      const hasActiveLine = activeIdx !== -1;

      if (uriChanged) {
        lastUriRef.current = uri;
        setActiveLine(null);
        setNextLine(null);
        setHasActiveLyric(false);
        activeWordsKeyRef.current = '';
        setActiveLineWords([]);
        setActiveLineProgress(0);
        wordRefs.current = [];
      }

      setSnapshotReady(true);
      setHasTrack(Boolean(track));
      setHasVisibleLyrics(hasActiveLine);
      const playingNow = snap.playback.state === 'Playing';
      setIsPlaying(playingNow);
      setLyricsStatus(snap.lyrics_status);
      setArtworkUrl(track?.artwork_url ?? null);
      setTrackTitle(track?.title ?? '');
      setTrackArtist(track?.artist ?? '');
      const nextWords = snap.active_line_words ?? [];
      const nextWordsKey = wordsKey(nextWords);
      if (nextWordsKey !== activeWordsKeyRef.current) {
        activeWordsKeyRef.current = nextWordsKey;
        setActiveLineWords(nextWords);
      }
      setActiveLineProgress(Math.max(0, Math.min(1, snap.line_progress ?? 0)));

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
      } else {
        baselineRef.current = { ms: currentInterp, at: now, targetMs: correctedPos, targetAt: now, blendDur: BLEND_MS };
      }

      if (uri && snap.lyrics_status === 'Loading' && refreshedUriRef.current !== uri) {
        refreshedUriRef.current = uri;
        invoke('refresh_lyrics').catch(() => { });
      }

      setHasActiveLyric(hasActiveLine);
      if (hasActiveLine) {
        setActiveLine(snap.visible_lines[activeIdx].text);
        setNextLine(
          activeIdx + 1 < snap.visible_lines.length
            ? snap.visible_lines[activeIdx + 1].text
            : null
        );
      } else {
        setActiveLine(null);
        setNextLine(null);
      }
    };

    (async () => {
      await ensureIslandWindowReady();
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

  useEffect(() => {
    if (activeLineWords.length === 0 || !pageVisible || !surfaceVisible) return;
    return runWordColouring(activeLineWords, wordRefs, baselineRef, isPlaying);
  }, [activeLineWords, isPlaying, pageVisible, surfaceVisible]);

  const artSrc = artworkUrl ?? FALLBACK_ART;
  const panelState = resolveLyricsSurfaceState({
    booted: snapshotReady,
    hasTrack,
    lyricsStatus,
    hasContent: hasVisibleLyrics,
  });
  const showTrackIntro =
    snapshotReady &&
    hasTrack &&
    !hasActiveLyric &&
    trackTitle.length > 0 &&
    !isLyricsError(lyricsStatus) &&
    !isLyricsNotFound(lyricsStatus);
  const barsActive = (panelState === 'ready' || showTrackIntro) && isPlaying;
  // Identity of the current active line — used as a React key so the line
  // element remounts (and replays its enter animation) on every line change.
  const activeContentKey = activeLineWords.length > 0
    ? activeLineWords.map((word) => `${word.start_ms}:${word.text}`).join('|')
    : activeLine || '';

  return (
    <div
      className={`floating-panel ${locked ? 'locked' : 'unlocked'} ${isDocked ? 'docked' : 'floating'} ${panelState !== 'ready' && !showTrackIntro ? 'has-placeholder' : ''}`}
      onMouseDown={(e) => {
        if (locked || e.button !== 0) return;
        e.preventDefault();
        void getCurrentWindow().startDragging();
      }}
    >
      <div className="island-background">
        <img src={artSrc} alt="" className="island-bg-img" decoding="async" />
        <div className="island-bg-dimmer"></div>
      </div>

      <div className="panel-content">
        {showCover && (
          <div className={`panel-art ${coverCircle ? 'is-circle' : ''} ${coverSpin ? 'is-spinning' : ''} ${!isPlaying ? 'is-paused' : ''}`}>
            <img
              src={artSrc}
              className={`panel-cover ${artworkUrl ? '' : 'placeholder'}`}
              draggable={false}
              alt={hasTrack ? 'Album' : ''}
              decoding="async"
            />
          </div>
        )}

        <div className={`panel-lyrics-stack ${panelState !== 'ready' && !showTrackIntro ? 'is-placeholder' : ''}`}>
          {panelState === 'ready' ? (
            <>
              <GlidingLine
                key={activeContentKey}
                className={`panel-lyric-active ${hasActiveLyric ? '' : 'is-preroll'}`}
                contentKey={activeContentKey}
                syncProgress={activeLineProgress}
              >
                {activeLineWords.length > 0 ? (
                  activeLineWords.map((w, i) => (
                    <span
                      key={i}
                      ref={(el) => { wordRefs.current[i] = el; }}
                      className="lyric-word upcoming"
                    >{w.text}</span>
                  ))
                ) : (
                  activeLine || (nextLine !== null ? '♪' : '')
                )}
              </GlidingLine>
              <div className="panel-lyric-next" key={nextLine || 'none'}>
                {nextLine === '' ? '♪' : (nextLine || '')}
              </div>
            </>
          ) : showTrackIntro ? (
            <>
              <div className="panel-lyric-active is-track-intro">{trackTitle}</div>
              <div className="panel-lyric-next is-track-intro">{trackArtist}</div>
            </>
          ) : (
            <PanelPlaceholder state={panelState} />
          )}
        </div>

        <div className={`audio-bars ${barsActive ? '' : 'is-idle'}`}>
          <span className="bar"></span>
          <span className="bar"></span>
          <span className="bar"></span>
        </div>
      </div>
    </div>
  );
}

function GlidingLine({
  className,
  contentKey,
  syncProgress,
  children,
}: {
  className: string;
  contentKey: string;
  syncProgress: number;
  children: ReactNode;
}) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [overflowPx, setOverflowPx] = useState(0);

  useEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return;

    const updateOverflow = () => {
      const nextOverflow = Math.max(0, Math.ceil(content.scrollWidth - viewport.clientWidth));
      setOverflowPx((current) => (current === nextOverflow ? current : nextOverflow));
    };

    updateOverflow();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateOverflow);
      return () => window.removeEventListener('resize', updateOverflow);
    }

    const observer = new ResizeObserver(updateOverflow);
    observer.observe(viewport);
    observer.observe(content);
    return () => observer.disconnect();
  }, [contentKey]);

  const isGliding = overflowPx > 0;
  const normalizedReveal = syncProgress <= 0.06
    ? 0
    : syncProgress >= 0.78
      ? 1
      : (syncProgress - 0.06) / 0.72;
  const revealProgress = normalizedReveal * normalizedReveal * (3 - 2 * normalizedReveal);
  const style = isGliding
    ? {
      '--glide-shift': `${overflowPx}px`,
      transform: `translateX(${-overflowPx * revealProgress}px)`,
    } as CSSProperties
    : undefined;

  return (
    <div className={`${className} ${isGliding ? 'is-gliding' : ''}`} ref={viewportRef}>
      <div className="panel-lyric-content" ref={contentRef} style={style}>
        {children}
      </div>
    </div>
  );
}

function PanelPlaceholder({ state }: { state: LyricsPlaceholderState }) {
  const loading = state === 'booting' || state === 'loading';

  return (
    <div className={`panel-placeholder is-${state} ${loading ? 'is-loading' : ''}`} role="status" aria-label={getCompactPlaceholderLabel(state)}>
      <span className="panel-placeholder-indicator" aria-hidden="true">
        <LyricsPlaceholderIcon state={state} className="panel-placeholder-icon" />
      </span>
      <span className="panel-placeholder-lines" aria-hidden="true">
        <span className="panel-placeholder-line primary" />
        <span className="panel-placeholder-line secondary" />
      </span>
    </div>
  );
}

function getCompactPlaceholderLabel(state: LyricsPlaceholderState) {
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
