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

type LyricWord = { start_ms: number; end_ms: number; text: string };

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
const BLEND_MS = 500;
const FALLBACK_ART = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>';

type PositionBaseline = {
  ms: number;
  at: number;
  targetMs: number;
  targetAt: number;
  blendDur: number;
};

function interpolatePosition(b: PositionBaseline, now: number, playing: boolean): number {
  if (!playing) return b.ms;
  const currentTraj = b.ms + (now - b.at);
  const targetTraj = b.targetMs + (now - b.targetAt);
  const elapsed = now - b.at;
  if (elapsed >= b.blendDur) return targetTraj;
  const t = elapsed / Math.max(1, b.blendDur);
  return currentTraj * (1 - t) + targetTraj * t;
}

function applyIslandFont(scale: number) {
  document.documentElement.style.setProperty('--font-scale', String(scale));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function snapToTopEdge(value: number, topEdge: number) {
  return value <= topEdge + TOP_DOCK_SNAP_PX ? topEdge : value;
}

async function setIslandPanelPosition(x: number, y: number) {
  await invoke('set_overlay_position', { label: 'island', x, y });
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
  const saveTimerRef = useRef<number | null>(null);
  const refreshedUriRef = useRef('');
  const lastUriRef = useRef('');
  const baselineRef = useRef<PositionBaseline>({ ms: 0, at: 0, targetMs: 0, targetAt: 0, blendDur: 1 });
  const wordRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const pageVisible = usePageVisible();
  const hideWhenPausedRef = useRef(false);
  const autoHiddenRef = useRef(false);

  // Init: read persisted state, position window, subscribe to lock + settings changes.
  useEffect(() => {
    let unlistenLock: (() => void) | undefined;
    let unlistenMove: (() => void) | undefined;
    let unlistenSettings: (() => void) | undefined;

    (async () => {
      const win = getCurrentWindow();
      const [state, appSettings] = await Promise.all([
        invoke<UiState>('get_ui_state'),
        invoke<{ behavior: { hide_when_paused: boolean } }>('get_settings'),
      ]);
      hideWhenPausedRef.current = appSettings.behavior.hide_when_paused;
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
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    };
  }, []);

  // Auto-hide/show the window when playback state changes, if hide_when_paused is enabled.
  useEffect(() => {
    if (!snapshotReady) return;
    const win = getCurrentWindow();
    if (hideWhenPausedRef.current && !isPlaying) {
      autoHiddenRef.current = true;
      void win.hide();
    } else if (autoHiddenRef.current && isPlaying) {
      autoHiddenRef.current = false;
      void win.show();
    }
  }, [isPlaying, snapshotReady]);

  // Subscribe to backend `playback-tick` events. See app view for rationale.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    const apply = (snap: RenderSnapshot) => {
      if (cancelled) return;
      const track = snap.playback.track;
      const uri = track?.uri ?? '';
      const activeIdx = snap.visible_lines.findIndex((line) => line.is_active);
      const hasActiveLine = activeIdx !== -1;

      setSnapshotReady(true);
      setHasTrack(Boolean(track));
      setHasVisibleLyrics(hasActiveLine);
      const playingNow = snap.playback.state === 'Playing';
      setIsPlaying(playingNow);
      setLyricsStatus(snap.lyrics_status);
      setArtworkUrl(track?.artwork_url ?? null);
      setTrackTitle(track?.title ?? '');
      setTrackArtist(track?.artist ?? '');
      setActiveLineWords(snap.active_line_words ?? []);
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

      if (uri !== lastUriRef.current) {
        lastUriRef.current = uri;
        setActiveLine(null);
        setNextLine(null);
        setHasActiveLyric(false);
        setActiveLineWords([]);
        setActiveLineProgress(0);
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
    if (activeLineWords.length === 0 || !pageVisible) return;
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
      if (isPlaying) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [activeLineWords, isPlaying, pageVisible]);

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
        <img src={artSrc} alt="" className="island-bg-img" />
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
            />
          </div>
        )}

        <div className={`panel-lyrics-stack ${panelState !== 'ready' && !showTrackIntro ? 'is-placeholder' : ''}`}>
          {panelState === 'ready' ? (
            <>
              <GlidingLine
                className={`panel-lyric-active ${hasActiveLyric ? '' : 'is-preroll'}`}
                contentKey={activeLineWords.length > 0
                  ? activeLineWords.map((word) => `${word.start_ms}:${word.text}`).join('|')
                  : activeLine || ''}
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
              <div className="panel-lyric-next">
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

