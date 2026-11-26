import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { GlidingLine, type GlideClock } from '@/components/gliding-line';
import { VocalCountdown } from '@/components/vocal-countdown';
import type { DockImpulse, LyricLineSlim, LyricWord, MarqueeDock, VocalCue } from '@/types/tauri-contracts';
import { TransportGlyph } from '@/components/transport-glyph';
import {
  resolveLyricsSurfaceState,
  type LyricsPlaceholderState,
} from '@/utils/lyrics-state';
import {
  shouldShowTrackIntro,
  getActiveContentKey,
  getCurrentLineFallback,
  getNextLineText,
  renderLyricContent,
} from '@/utils/lyric-renderer';
import { PanelPlaceholder } from './components/placeholder';
import { usePageVisible } from '@/utils/use-page-visible';
import { useArtworkFallback } from '@/hooks/use-artwork-fallback';
import { useCrossfadeSrc } from '@/hooks/use-crossfade-src';
import { useSurfaceAutoHide } from '@/hooks/use-surface-auto-hide';
import { useWordColouring } from '@/hooks/use-word-colouring';
import { useMarqueeFrame } from '@/hooks/use-marquee-frame';
import { makeWindowReady } from '@/utils/playback-sync';
import { useMarqueeInteraction } from './hooks/use-interaction';
import { useMarqueeMenu } from './hooks/use-marquee-menu';
import { useMarqueePeek, type PeekReturnCue } from './hooks/use-marquee-peek';
import { METER_REST_SCALE, useAudioVisualizer } from './hooks/use-audio-visualizer';
import { useProgressRing } from './hooks/use-progress-ring';
import { useMarqueePlayback } from './hooks/use-playback';
import { useMarqueeSettings } from './hooks/use-settings';
import { TRANSPARENT_FALLBACK_ART } from '@/utils/artwork';
import { playbackPlayPause, playbackRaise } from '@/utils/tauri-commands';
import './marquee.css';

const SURFACE_LABEL = 'marquee';
const ensureMarqueeWindowReady = makeWindowReady(SURFACE_LABEL);
const BAR_KEYS = ['bar-left-outer', 'bar-left-inner', 'bar-right-inner', 'bar-right-outer'] as const;
const DEFAULT_DOCK: MarqueeDock = { top: false, right: false, bottom: false, left: false };
const EMPTY_LINES: LyricLineSlim[] = [];
const EMPTY_WORDS: LyricWord[] = [];
const FEEDBACK_MS = 1400;

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function shouldPlayImpulse(batterySaver: boolean): boolean {
  if (batterySaver || prefersReducedMotion()) return false;
  const { lowPower, surfaceVisible } = document.documentElement.dataset;
  return lowPower !== 'true' && surfaceVisible !== 'false';
}

function impulseVector(impulse: DockImpulse): { dx: number; dy: number; attach: boolean; edge: 'top' | 'bottom' | 'left' | 'right' } {
  switch (impulse) {
    case 'attach_top': return { dx: 0, dy: -2.5, attach: true, edge: 'top' };
    case 'attach_bottom': return { dx: 0, dy: 2.5, attach: true, edge: 'bottom' };
    case 'attach_left': return { dx: -2.5, dy: 0, attach: true, edge: 'left' };
    case 'attach_right': return { dx: 2.5, dy: 0, attach: true, edge: 'right' };
    case 'detach_top': return { dx: 0, dy: 3.5, attach: false, edge: 'top' };
    case 'detach_bottom': return { dx: 0, dy: -3.5, attach: false, edge: 'bottom' };
    case 'detach_left': return { dx: 3.5, dy: 0, attach: false, edge: 'left' };
    case 'detach_right': return { dx: -3.5, dy: 0, attach: false, edge: 'right' };
  }
}

function renderPanelContent({
  panelState,
  vocalCue,
  showTrackIntro,
  activeContentKey,
  hasActiveLyric,
  activeLineProgress,
  glideClock,
  resizing,
  lineContent,
  nextLine,
  trackTitle,
  trackArtist,
  isPeeking,
  peekIndex,
  peekDirection,
  peekLine,
  peekNextLine,
  returnCue,
}: Readonly<{
  panelState: LyricsPlaceholderState;
  vocalCue: VocalCue | null;
  showTrackIntro: boolean;
  activeContentKey: string;
  hasActiveLyric: boolean;
  activeLineProgress: number;
  glideClock: GlideClock;
  resizing: boolean;
  lineContent: ReactNode;
  nextLine: string | null;
  trackTitle: string;
  trackArtist: string;
  isPeeking: boolean;
  peekIndex: number | null;
  peekDirection: -1 | 1;
  peekLine: string | null;
  peekNextLine: string | null;
  returnCue: PeekReturnCue | null;
}>): ReactNode {
  if (isPeeking && peekLine !== null) {
    const dirClass = peekDirection > 0 ? 'is-peek-down' : 'is-peek-up';
    const peekKey = `peek-${peekIndex}`;
    return (
      <>
        <GlidingLine
          key={peekKey}
          className={`panel-lyric-active is-peeking ${dirClass}`}
          contentClassName="panel-lyric-content"
          contentKey={`${peekKey}-${peekLine}`}
          syncProgress={0}
          freezeOverflow={resizing}
        >
          {peekLine}
        </GlidingLine>
        <div className={`panel-lyric-next is-peeking ${dirClass}`} key={`peek-next-${peekIndex}`}>
          {getNextLineText(peekNextLine)}
        </div>
      </>
    );
  }

  if (vocalCue) {
    return (
      <>
        <div className="panel-lyric-active"><VocalCountdown seconds={vocalCue.seconds} /></div>
        <div className="panel-lyric-next">{vocalCue.next_line}</div>
      </>
    );
  }

  if (panelState === 'ready') {
    const returnClass = returnCue ? `is-peek-return-${returnCue.direction > 0 ? 'down' : 'up'}` : '';
    const liveKey = returnCue ? `${activeContentKey}-ret-${returnCue.seq}` : activeContentKey;
    const liveNextKey = returnCue ? `${nextLine || 'none'}-ret-${returnCue.seq}` : (nextLine || 'none');
    return (
      <>
        <GlidingLine
          key={liveKey}
          className={`panel-lyric-active ${hasActiveLyric ? '' : 'is-preroll'} ${returnClass}`}
          contentClassName="panel-lyric-content"
          contentKey={liveKey}
          syncProgress={activeLineProgress}
          clock={glideClock}
          freezeOverflow={resizing}
        >
          {lineContent}
        </GlidingLine>
        <div className={`panel-lyric-next ${returnClass}`} key={liveNextKey}>
          {getNextLineText(nextLine)}
        </div>
      </>
    );
  }

  if (showTrackIntro) {
    return (
      <>
        <div className="panel-lyric-active is-track-intro">{trackTitle}</div>
        <div className="panel-lyric-next is-track-intro">{trackArtist}</div>
      </>
    );
  }

  return <PanelPlaceholder state={panelState} />;
}

export default function Marquee() {
  const [locked, setLocked] = useState(true);
  const [showCover, setShowCover] = useState(true);
  const [coverCircle, setCoverCircle] = useState(false);
  const [coverSpin, setCoverSpin] = useState(false);
  const [surfaceVisible, setSurfaceVisible] = useState(false);
  const [marqueeLines, setMarqueeLines] = useState(2);
  const [hideWhenPaused, setHideWhenPaused] = useState(false);
  const [hideWhenIdle, setHideWhenIdle] = useState(true);
  const [batterySaver, setBatterySaver] = useState(false);
  const [transparency, setTransparency] = useState(0.5);
  const [menuOpen, setMenuOpen] = useState(false);
  const [statusFeedback, setStatusFeedback] = useState<{ id: number; text: string } | null>(null);

  const {
    activeLine,
    vocalCue,
    nextLine,
    artworkUrl,
    trackTitle,
    trackArtist,
    hasTrack,
    hasVisibleLyrics,
    isPlaying,
    togglePlaying,
    caps,
    lyricsStatus,
    snapshotReady,
    hasActiveLyric,
    activeLineWords,
    activeLineProgress,
    activeLineIndex,
    lyricOffsetMs,
    lyricsRevision,
    allLines,
    durationMs,
    trackKey,
    baselineRef,
    wordRefs,
  } = useMarqueePlayback({ ensureWindowReady: ensureMarqueeWindowReady });

  const panelRef = useRef<HTMLDivElement | null>(null);
  const panelContentRef = useRef<HTMLDivElement | null>(null);
  const sheenRef = useRef<HTMLDivElement | null>(null);
  const swipeCuePrevRef = useRef<HTMLSpanElement | null>(null);
  const swipeCueNextRef = useRef<HTMLSpanElement | null>(null);
  const visualizerRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const impulseAnimRef = useRef<Animation | null>(null);
  const sheenAnimRef = useRef<Animation | null>(null);
  const swipeCueAnimRef = useRef<Animation | null>(null);
  const feedbackTimerRef = useRef<number | null>(null);
  const feedbackSeqRef = useRef(0);
  const pageVisible = usePageVisible();
  const desiredVisibleRef = useRef(true);
  const autoHiddenRef = useRef(false);

  const showStatusFeedback = useCallback((text: string) => {
    const id = ++feedbackSeqRef.current;
    setStatusFeedback({ id, text });
    if (feedbackTimerRef.current !== null) {
      globalThis.clearTimeout(feedbackTimerRef.current);
    }
    feedbackTimerRef.current = globalThis.setTimeout(() => {
      feedbackTimerRef.current = null;
      setStatusFeedback((prev) => (prev?.id === id ? null : prev));
    }, FEEDBACK_MS);
  }, []);

  useEffect(() => () => {
    if (feedbackTimerRef.current !== null) {
      globalThis.clearTimeout(feedbackTimerRef.current);
      feedbackTimerRef.current = null;
    }
  }, []);

  const artUrl = artworkUrl ?? '';
  const { artworkError, setArtworkError } = useArtworkFallback(artUrl);

  useMarqueeSettings({
    ensureWindowReady: ensureMarqueeWindowReady,
    desiredVisibleRef,
    autoHiddenRef,
    setSurfaceVisible,
    setHideWhenPaused,
    setHideWhenIdle,
    setLocked,
    setShowCover,
    setCoverCircle,
    setCoverSpin,
    setMarqueeLines,
    setBatterySaver,
    setTransparency,
  });

  useSurfaceAutoHide({
    snapshotReady,
    hideWhenPaused,
    hideWhenIdle,
    isPlaying,
    hasTrack,
    desiredVisibleRef,
    autoHiddenRef,
    setSurfaceVisible,
  });

  // The meter is decorative; battery saver keeps it at rest.
  useAudioVisualizer({
    isPlaying: isPlaying && !batterySaver,
    pageVisible,
    surfaceVisible,
    trackKey,
    trackTitle,
    trackArtist,
    activeLineWords,
    visualizerRefs,
    baselineRef,
  });

  useProgressRing({
    isPlaying,
    durationMs,
    pageVisible,
    surfaceVisible,
    progressTargetRef: panelRef,
    baselineRef,
  });

  const frame = useMarqueeFrame(ensureMarqueeWindowReady);
  const dock: MarqueeDock = frame?.dock ?? DEFAULT_DOCK;

  const onDockImpulse = useCallback((impulse: DockImpulse) => {
    if (!shouldPlayImpulse(batterySaver)) return;
    const { dx, dy, attach, edge } = impulseVector(impulse);
    const contentEl = panelContentRef.current;
    if (contentEl) {
      impulseAnimRef.current?.cancel();
      impulseAnimRef.current = contentEl.animate(
        [
          { transform: 'translate3d(0px, 0px, 0px)' },
          { transform: `translate3d(${dx}px, ${dy}px, 0px)`, offset: 0.35 },
          { transform: `translate3d(${-dx * 0.2}px, ${-dy * 0.2}px, 0px)`, offset: 0.72 },
          { transform: 'translate3d(0px, 0px, 0px)' },
        ],
        {
          duration: attach ? 250 : 220,
          easing: attach ? 'cubic-bezier(0.22, 1, 0.36, 1)' : 'cubic-bezier(0.16, 1, 0.3, 1)',
        },
      );
    }

    const sheenEl = sheenRef.current;
    if (attach && sheenEl) {
      sheenAnimRef.current?.cancel();
      sheenEl.setAttribute('data-sheen-edge', edge);
      sheenAnimRef.current = sheenEl.animate(
        [{ opacity: 0 }, { opacity: 0.85, offset: 0.28 }, { opacity: 0 }],
        { duration: 380, easing: 'ease-out' },
      );
    }
  }, [batterySaver]);

  const onSwipeSkip = useCallback((direction: 'next' | 'previous') => {
    if (!shouldPlayImpulse(batterySaver)) return;
    const dx = direction === 'next' ? -7 : 7;
    const contentEl = panelContentRef.current;
    if (contentEl) {
      impulseAnimRef.current?.cancel();
      impulseAnimRef.current = contentEl.animate(
        [
          { transform: `translate3d(${dx}px, 0px, 0px)` },
          { transform: 'translate3d(0px, 0px, 0px)' },
        ],
        { duration: 220, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
      );
    }

    const cueEl = direction === 'next' ? swipeCueNextRef.current : swipeCuePrevRef.current;
    if (cueEl) {
      const nudge = direction === 'next' ? 4 : -4;
      swipeCueAnimRef.current?.cancel();
      swipeCueAnimRef.current = cueEl.animate(
        [
          { opacity: 0.9, transform: 'translateY(-50%) scale(1.06)' },
          { opacity: 0, transform: `translate(${nudge}px, -50%) scale(0.92)` },
        ],
        { duration: 280, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
      );
    }
  }, [batterySaver]);

  const onOpenMain = useCallback(() => {
    if (!shouldPlayImpulse(batterySaver)) return;
    const dx = (dock.left ? 3 : 0) - (dock.right ? 3 : 0);
    const dy = (dock.top ? 3 : 0) - (dock.bottom ? 3 : 0);
    const contentEl = panelContentRef.current;
    if (contentEl) {
      impulseAnimRef.current?.cancel();
      impulseAnimRef.current = contentEl.animate(
        [
          { transform: 'translate3d(0px, 0px, 0px) scale(1)' },
          { transform: 'translate3d(0px, 0px, 0px) scale(0.968)', offset: 0.24 },
          { transform: `translate3d(${dx}px, ${dy}px, 0px) scale(1.014)`, offset: 0.58 },
          { transform: 'translate3d(0px, 0px, 0px) scale(1)' },
        ],
        { duration: 240, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
      );
    }

    const sheenEl = sheenRef.current;
    if (sheenEl) {
      sheenAnimRef.current?.cancel();
      sheenEl.setAttribute('data-sheen-edge', 'launch');
      sheenAnimRef.current = sheenEl.animate(
        [{ opacity: 0 }, { opacity: 0.9, offset: 0.26 }, { opacity: 0 }],
        { duration: 280, easing: 'ease-out' },
      );
    }
  }, [batterySaver, dock.bottom, dock.left, dock.right, dock.top]);

  const onPeekBoundary = useCallback((direction: -1 | 1) => {
    if (!shouldPlayImpulse(batterySaver)) return;
    const dy = direction > 0 ? -3 : 3;
    const contentEl = panelContentRef.current;
    if (!contentEl) return;
    impulseAnimRef.current?.cancel();
    impulseAnimRef.current = contentEl.animate(
      [
        { transform: 'translate3d(0px, 0px, 0px)' },
        { transform: `translate3d(0px, ${dy}px, 0px)`, offset: 0.4 },
        { transform: 'translate3d(0px, 0px, 0px)' },
      ],
      { duration: 200, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
    );
  }, [batterySaver]);

  const hasSyncedLyrics = hasTrack && lyricsStatus === 'Ready';
  const peekSessionKey = `${trackKey}:${lyricsRevision}:${hasSyncedLyrics ? 'ready' : 'unready'}`;
  const {
    isPeeking,
    peekIndex,
    peekDirection,
    peekLine,
    peekNextLine,
    peekLabel,
    peekSeq,
    returnCue,
    stepPeek,
    cancelPeek,
    returnToLive,
  } = useMarqueePeek({
    sessionKey: peekSessionKey,
    lines: hasSyncedLyrics ? allLines : EMPTY_LINES,
    activeLineIndex,
    menuOpen,
    onBoundary: onPeekBoundary,
  });

  const openMenu = useMarqueeMenu({
    hasTrack,
    trackKey,
    hasSyncedLyrics,
    lyricOffsetMs,
    currentLineText: isPeeking ? peekLine : activeLine,
    locked,
    onOpenMain,
    onCancelPeek: cancelPeek,
    onFeedback: showStatusFeedback,
    onMenuOpenChange: setMenuOpen,
  });

  useEffect(() => {
    if (!isPeeking) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        returnToLive();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isPeeking, returnToLive]);

  const { hovered, edge, dragging, resizeEdge, transportPressed, handlers } = useMarqueeInteraction({
    ensureWindowReady: ensureMarqueeWindowReady,
    locked,
    dock,
    panelRef,
    onDockImpulse,
    onSwipeSkip,
    onOpenMain,
    onPeekStep: stepPeek,
    onPeekReturn: returnToLive,
    onContextMenuOpen: openMenu,
    onCancelPeek: cancelPeek,
    caps,
    onTogglePlaying: togglePlaying,
  });
  const canToggle = hasTrack && caps.play_pause;

  useWordColouring({
    words: isPeeking ? EMPTY_WORDS : activeLineWords,
    wordRefs,
    baselineRef,
    isPlaying,
    pageVisible,
    surfaceVisible,
  });

  const hasArtwork = Boolean(artworkUrl) && !artworkError;
  const artSrc = hasArtwork ? (artworkUrl ?? TRANSPARENT_FALLBACK_ART) : TRANSPARENT_FALLBACK_ART;
  const art = useCrossfadeSrc(artSrc);
  const panelState = resolveLyricsSurfaceState({
    booted: snapshotReady,
    hasTrack,
    lyricsStatus,
    hasContent: hasVisibleLyrics || vocalCue !== null || (isPeeking && peekLine !== null),
  });
  const showTrackIntro = !isPeeking && shouldShowTrackIntro({
    snapshotReady,
    hasTrack,
    hasActiveLyric,
    trackTitle,
    lyricsStatus,
  });
  const barsActive = (panelState === 'ready' || showTrackIntro) && isPlaying;

  const activeContentKey = getActiveContentKey(activeLineWords, activeLine);
  const isCompactLayout = marqueeLines <= 1;
  const currentLineFallback = getCurrentLineFallback(activeLine, nextLine);
  const lineContent = renderLyricContent(activeLineWords, wordRefs, currentLineFallback);
  const panelContent = renderPanelContent({
    panelState,
    vocalCue,
    showTrackIntro,
    activeContentKey,
    hasActiveLyric,
    activeLineProgress,
    resizing: resizeEdge !== null,
    glideClock: {
      words: activeLineWords,
      baselineRef,
      isPlaying,
      running: pageVisible && surfaceVisible,
    },
    lineContent,
    nextLine,
    trackTitle,
    trackArtist,
    isPeeking,
    peekIndex,
    peekDirection,
    peekLine,
    peekNextLine,
    returnCue,
  });

  return (
    <div
      ref={panelRef}
      className={`floating-panel ${locked ? 'locked' : 'unlocked'} ${dock.top || dock.right || dock.bottom || dock.left ? 'docked' : 'floating'} ${panelState !== 'ready' && !showTrackIntro ? 'has-placeholder' : ''} ${isCompactLayout ? 'is-compact' : ''} ${isPeeking ? 'is-peeking' : ''} ${hovered ? 'is-hovered' : ''} ${dragging ? 'is-dragging' : ''} ${transparency > 0.5 ? 'is-clear' : ''}`}
      style={{
        '--marquee-transparency': String(transparency),
        '--marquee-scale': String(frame?.scale ?? 1),
        '--marquee-notch-inset': `${frame?.notch_inset ?? 0}px`,
      } as CSSProperties}
      role="region"
      aria-label="Marquee"
      data-resize-edge={resizeEdge ?? undefined}
      data-menu-open={menuOpen ? 'true' : undefined}
      data-dock-top={dock.top ? 'true' : undefined}
      data-dock-right={dock.right ? 'true' : undefined}
      data-dock-bottom={dock.bottom ? 'true' : undefined}
      data-dock-left={dock.left ? 'true' : undefined}
      {...handlers}
    >
      <div className="marquee-background">
        {art.previous && (
          <img src={art.previous} alt="" className="marquee-bg-img marquee-bg-previous" decoding="async" />
        )}
        <img
          key={art.id}
          src={art.current}
          alt=""
          className={`marquee-bg-img ${art.previous ? 'is-entering' : ''}`}
          decoding="async"
          onError={() => setArtworkError(true)}
          onAnimationEnd={art.onEntered}
        />
        <div className="marquee-bg-dimmer"></div>
      </div>

      <div className="marquee-dock-sheen" ref={sheenRef} aria-hidden="true" />
      <span ref={swipeCuePrevRef} className="marquee-swipe-cue is-prev" aria-hidden="true">
        <svg viewBox="0 0 12 18" width="10" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 2L3 9l6 7" />
        </svg>
      </span>
      <span ref={swipeCueNextRef} className="marquee-swipe-cue is-next" aria-hidden="true">
        <svg viewBox="0 0 12 18" width="10" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 2l6 7-6 7" />
        </svg>
      </span>

      <div className="panel-content" ref={panelContentRef}>
        {showCover && (
          <div
            className={`panel-art-container ${coverCircle ? 'is-circle' : ''}`}
            style={{ position: 'relative', flexShrink: 0 }}
            role={caps.raise ? 'button' : undefined}
            tabIndex={caps.raise ? 0 : undefined}
            aria-label={caps.raise ? 'Open player app' : undefined}
            data-marquee-action={caps.raise ? 'raise' : undefined}
            onKeyDown={caps.raise ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                playbackRaise().catch(() => undefined);
              }
            } : undefined}
          >
            <div className={`panel-art ${coverCircle ? 'is-circle' : ''} ${coverSpin ? 'is-spinning' : ''} ${isPlaying ? '' : 'is-paused'}`}>
              {art.previous && (
                <img
                  src={art.previous}
                  className={`panel-cover panel-cover-previous ${hasArtwork ? '' : 'placeholder'}`}
                  draggable={false}
                  alt=""
                  decoding="async"
                />
              )}
              <img
                key={art.id}
                src={art.current}
                className={`panel-cover ${hasArtwork ? '' : 'placeholder'} ${art.previous ? 'is-entering' : ''}`}
                draggable={false}
                alt={hasTrack && !artworkError ? 'Album' : ''}
                decoding="async"
                onError={() => setArtworkError(true)}
              />
            </div>
            {hasTrack && durationMs > 0 && (
              <svg className="progress-ring-svg" viewBox="0 0 44 44">
                {coverCircle ? (
                  <>
                    <circle className="progress-ring-bg" cx="22" cy="22" r="20" />
                    <circle className="progress-ring-fill circle-fill" cx="22" cy="22" r="20" />
                  </>
                ) : (
                  <>
                    <rect className="progress-ring-bg" x="2" y="2" width="40" height="40" rx="12" />
                    <rect className="progress-ring-fill rect-fill" x="2" y="2" width="40" height="40" rx="12" />
                  </>
                )}
              </svg>
            )}
          </div>
        )}

        <div
          className={`panel-lyrics-stack ${panelState !== 'ready' && !showTrackIntro ? 'is-placeholder' : ''}`}
        >
          {panelContent}
        </div>

        {statusFeedback ? (
          <span key={statusFeedback.id} className="marquee-status-pill" role="status" aria-live="polite">
            {statusFeedback.text}
          </span>
        ) : isPeeking && peekLabel ? (
          <span
            className="marquee-peek-pill"
            role="button"
            tabIndex={0}
            aria-label="Return to live lyric"
            title="Return to live lyric"
            data-marquee-action="peek-return"
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                returnToLive();
              }
            }}
          >
            <span className="marquee-peek-pill-label">{peekLabel}</span>
            <span key={peekSeq} className="marquee-peek-pill-timer" aria-hidden="true" />
          </span>
        ) : null}

        <div
          className={`marquee-meter ${canToggle ? 'can-toggle' : ''}`}
          role={canToggle ? 'button' : undefined}
          tabIndex={canToggle ? 0 : undefined}
          aria-label={canToggle ? (isPlaying ? 'Pause' : 'Play') : undefined}
          data-marquee-action={canToggle ? 'toggle' : undefined}
          data-pressed={transportPressed || undefined}
          onKeyDown={canToggle ? (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              togglePlaying();
              playbackPlayPause().catch(() => undefined);
            }
          } : undefined}
        >
          <div
            className={`audio-bars ${barsActive ? 'is-playing' : 'is-paused'}`}
            aria-hidden="true"
          >
            {BAR_KEYS.map((key, i) => {
              return (
                <span
                  key={key}
                  ref={(el) => { visualizerRefs.current[i] = el; }}
                  className="bar"
                  style={{
                    '--meter-scale': String(METER_REST_SCALE),
                    '--meter-opacity': '0.36',
                  } as CSSProperties}
                />
              );
            })}
          </div>
          {canToggle && <TransportGlyph playing={isPlaying} className="marquee-glyph" />}
        </div>
      </div>

      {!locked && !dock.left && (
        <span
          className={`marquee-resize-handle is-left ${edge === -1 ? 'is-near' : ''}`}
          data-marquee-resize="left"
          aria-hidden="true"
        />
      )}
      {!locked && !dock.right && (
        <span
          className={`marquee-resize-handle is-right ${edge === 1 ? 'is-near' : ''}`}
          data-marquee-resize="right"
          aria-hidden="true"
        />
      )}
    </div>
  );
}
