import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { getCurrentWindow, currentMonitor, PhysicalPosition, PhysicalSize } from '@tauri-apps/api/window';
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
import './karaoke.css';

type UiState = {
  karaoke_visible: boolean;
  karaoke_font_scale: number;
  karaoke_position: string;
  karaoke_alignment: string;
  karaoke_width_pct: number;
  karaoke_offset_px: number;
  karaoke_lines: number;
  karaoke_bg_opacity: number;
  karaoke_bold: boolean;
};

type VisibleLine = { index: number; text: string; is_active: boolean };

type RenderSnapshot = {
  playback: {
    track: { uri: string; title: string; artist: string } | null;
    state: 'Playing' | 'Paused' | 'Stopped';
    position_ms: number | null;
    observed_at_ms: number;
  };
  lyrics_status: LyricsStatus;
  line_progress: number | null;
  visible_lines: VisibleLine[];
  active_line_words: LyricWord[] | null;
};

function applyStyle(s: UiState) {
  const root = document.documentElement.style;
  root.setProperty('--font-scale', String(s.karaoke_font_scale));
  root.setProperty('--karaoke-align', s.karaoke_alignment);
  root.setProperty(
    '--karaoke-placeholder-align',
    s.karaoke_alignment === 'left'
      ? 'flex-start'
      : s.karaoke_alignment === 'right'
        ? 'flex-end'
        : 'center',
  );
  root.setProperty('--karaoke-bg', String(s.karaoke_bg_opacity));
  root.setProperty('--karaoke-weight', s.karaoke_bold ? '800' : '500');
}

applySurfaceVisible(false);

async function applyLayout(s: UiState) {
  try {
    const win = getCurrentWindow();
    const monitor = await currentMonitor();
    if (!monitor) return;

    const height = s.karaoke_lines === 1 ? 110 : 180;
    const width = Math.round(monitor.workArea.size.width * (s.karaoke_width_pct / 100));
    const x = Math.round(
      monitor.workArea.position.x + (monitor.workArea.size.width - width) / 2,
    );
    const y =
      s.karaoke_position === 'top'
        ? monitor.workArea.position.y + s.karaoke_offset_px
        : monitor.workArea.position.y + monitor.workArea.size.height - height - s.karaoke_offset_px;

    await win.setSize(new PhysicalSize(width, height));
    await win.setPosition(new PhysicalPosition(x, y));
  } catch (e) {
    console.error(e);
  }
}

const SURFACE_LABEL = 'karaoke';
const ensureKaraokeWindowReady = makeWindowReady(SURFACE_LABEL);

export default function Karaoke() {
  const [activeLine, setActiveLine] = useState<string | null>(null);
  const [nextLine, setNextLine] = useState<string | null>(null);
  const [activeLineProgress, setActiveLineProgress] = useState(0);
  const [trackTitle, setTrackTitle] = useState('');
  const [trackArtist, setTrackArtist] = useState('');
  const [hasTrack, setHasTrack] = useState(false);
  const [hasVisibleLyrics, setHasVisibleLyrics] = useState(false);
  const [hasActiveLyric, setHasActiveLyric] = useState(false);
  const [lyricsStatus, setLyricsStatus] = useState<LyricsStatus>('Loading');
  const [snapshotReady, setSnapshotReady] = useState(false);
  const [lines, setLines] = useState(2);
  const [activeLineWords, setActiveLineWords] = useState<LyricWord[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [surfaceVisible, setSurfaceVisible] = useState(false);
  const layoutTimerRef = useRef<number | null>(null);
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

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let unlistenAppSettings: (() => void) | undefined;
    (async () => {
      // Show (or keep hidden) first so WKWebView's evaluateJavaScript
      // callback path is live before any further invoke() calls.
      await ensureKaraokeWindowReady();

      const [state, appSettings] = await Promise.all([
        invoke<UiState>('get_ui_state'),
        invoke<AppSettings>('get_settings'),
      ]);
      setHideWhenPaused(appSettings.behavior.hide_when_paused);
      setHideWhenIdle(appSettings.window.hide_when_idle);
      applyAppearance(appSettings.appearance);
      syncSurfaceVisible(desiredVisibleRef, autoHiddenRef, setSurfaceVisible, state.karaoke_visible);
      applyStyle(state);
      setLines(state.karaoke_lines);
      await applyLayout(state);

      unlisten = await listen<UiState>('ui-settings-changed', (e) => {
        syncSurfaceVisible(
          desiredVisibleRef,
          autoHiddenRef,
          setSurfaceVisible,
          e.payload.karaoke_visible,
        );
        applyStyle(e.payload);
        setLines(e.payload.karaoke_lines);
        if (layoutTimerRef.current) window.clearTimeout(layoutTimerRef.current);
        layoutTimerRef.current = window.setTimeout(() => applyLayout(e.payload), 50);
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

    })();
    return () => {
      unlisten?.();
      unlistenAppSettings?.();
      if (layoutTimerRef.current) window.clearTimeout(layoutTimerRef.current);
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
        setActiveLineProgress(0);
        activeWordsKeyRef.current = '';
        setActiveLineWords([]);
        wordRefs.current = [];
      }

      setSnapshotReady(true);
      setHasTrack(Boolean(track));
      setHasVisibleLyrics(hasActiveLine);
      setHasActiveLyric(hasActiveLine);
      setLyricsStatus(snap.lyrics_status);
      setTrackTitle(track?.title ?? '');
      setTrackArtist(track?.artist ?? '');
      setActiveLineProgress(Math.max(0, Math.min(1, snap.line_progress ?? 0)));
      const playingNow = snap.playback.state === 'Playing';
      setIsPlaying(playingNow);
      const nextWords = snap.active_line_words ?? [];
      const nextWordsKey = wordsKey(nextWords);
      if (nextWordsKey !== activeWordsKeyRef.current) {
        activeWordsKeyRef.current = nextWordsKey;
        setActiveLineWords(nextWords);
      }

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
      await ensureKaraokeWindowReady();
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

  const karaokeState = resolveLyricsSurfaceState({
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
  // Identity of the active line — React key so the element remounts and
  // replays its enter animation whenever the line changes.
  const activeContentKey = activeLineWords.length > 0
    ? activeLineWords.map((word) => `${word.start_ms}:${word.text}`).join('|')
    : activeLine || '';

  return (
    <div className={`karaoke-root ${karaokeState !== 'ready' && !showTrackIntro ? 'is-placeholder' : ''}`}>
      {karaokeState === 'ready' ? (
        <>
          <GlidingLine
            key={activeContentKey}
            className={`karaoke-current ${activeLineWords.length > 0 ? 'has-word-sync' : ''}`}
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
          {lines >= 2 && <div className="karaoke-next" key={nextLine || 'none'}>
            {nextLine === '' ? '♪' : (nextLine || '')}
          </div>}
        </>
      ) : showTrackIntro ? (
        <>
          <div className="karaoke-current is-track-intro">{trackTitle}</div>
          {lines >= 2 && trackArtist ? <div className="karaoke-next is-track-intro">{trackArtist}</div> : null}
        </>
      ) : (
        <KaraokePlaceholder state={karaokeState} lines={lines} />
      )}
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
      <div className="karaoke-lyric-content" ref={contentRef} style={style}>
        {children}
      </div>
    </div>
  );
}

function KaraokePlaceholder({
  state,
  lines,
}: {
  state: LyricsPlaceholderState;
  lines: number;
}) {
  const loading = state === 'booting' || state === 'loading';

  return (
    <div className={`karaoke-placeholder is-${state} ${loading ? 'is-loading' : ''}`} role="status" aria-label={getCompactPlaceholderLabel(state)}>
      <div className="karaoke-placeholder-orb" aria-hidden="true">
        <span className="karaoke-placeholder-ring" />
        <span className="karaoke-placeholder-core">
          <LyricsPlaceholderIcon state={state} className="karaoke-placeholder-icon" />
        </span>
      </div>
      {loading ? (
        <div className="karaoke-placeholder-dots" aria-hidden="true">
          <span className="karaoke-placeholder-dot" />
          <span className="karaoke-placeholder-dot" />
          <span className="karaoke-placeholder-dot" />
        </div>
      ) : lines >= 2 ? <div className="karaoke-placeholder-spacer" aria-hidden="true" /> : null}
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
