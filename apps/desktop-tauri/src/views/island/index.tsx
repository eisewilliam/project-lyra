import { useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { GlidingLine, type GlideClock } from '@/components/gliding-line';
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
import { useSurfaceAutoHide } from '@/hooks/use-surface-auto-hide';
import { useWordColouring } from '@/hooks/use-word-colouring';
import { useIslandFrame } from '@/hooks/use-island-frame';
import { makeWindowReady, applySurfaceVisible } from '@/utils/playback-sync';
import { useIslandInteraction } from './hooks/use-interaction';
import { METER_REST_SCALE, useAudioVisualizer } from './hooks/use-audio-visualizer';
import { useProgressRing } from './hooks/use-progress-ring';
import { useIslandPlayback } from './hooks/use-playback';
import { useIslandSettings } from './hooks/use-settings';
import { TRANSPARENT_FALLBACK_ART } from '@/utils/artwork';
import './island.css';

const SURFACE_LABEL = 'island';
const ensureIslandWindowReady = makeWindowReady(SURFACE_LABEL);
const BAR_KEYS = ['bar-left-outer', 'bar-left-inner', 'bar-right-inner', 'bar-right-outer'] as const;

applySurfaceVisible(false);



function renderPanelContent({
  panelState,
  showTrackIntro,
  activeContentKey,
  hasActiveLyric,
  activeLineProgress,
  glideClock,
  lineContent,
  nextLine,
  trackTitle,
  trackArtist,
}: Readonly<{
  panelState: LyricsPlaceholderState;
  showTrackIntro: boolean;
  activeContentKey: string;
  hasActiveLyric: boolean;
  activeLineProgress: number;
  glideClock: GlideClock;
  lineContent: ReactNode;
  nextLine: string | null;
  trackTitle: string;
  trackArtist: string;
}>): ReactNode {
  if (panelState === 'ready') {
    return (
      <>
        <GlidingLine
          key={activeContentKey}
          className={`panel-lyric-active ${hasActiveLyric ? '' : 'is-preroll'}`}
          contentClassName="panel-lyric-content"
          contentKey={activeContentKey}
          syncProgress={activeLineProgress}
          clock={glideClock}
        >
          {lineContent}
        </GlidingLine>
        <div className="panel-lyric-next" key={nextLine || 'none'}>
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

export default function Island() {
  const [locked, setLocked] = useState(true);
  const [showCover, setShowCover] = useState(true);
  const [coverCircle, setCoverCircle] = useState(false);
  const [coverSpin, setCoverSpin] = useState(false);
  const [surfaceVisible, setSurfaceVisible] = useState(false);
  const [islandLines, setIslandLines] = useState(2);
  const [hideWhenPaused, setHideWhenPaused] = useState(false);
  const [hideWhenIdle, setHideWhenIdle] = useState(true);
  const [batterySaver, setBatterySaver] = useState(false);
  const [transparency, setTransparency] = useState(0.5);

  const {
    activeLine,
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
    durationMs,
    trackKey,
    baselineRef,
    wordRefs,
  } = useIslandPlayback({ ensureWindowReady: ensureIslandWindowReady });

  const panelRef = useRef<HTMLDivElement | null>(null);
  const visualizerRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const pageVisible = usePageVisible();
  const desiredVisibleRef = useRef(true);
  const autoHiddenRef = useRef(false);

  const artUrl = artworkUrl ?? '';
  const { artworkError, setArtworkError } = useArtworkFallback(artUrl);

  useIslandSettings({
    ensureWindowReady: ensureIslandWindowReady,
    desiredVisibleRef,
    autoHiddenRef,
    setSurfaceVisible,
    setHideWhenPaused,
    setHideWhenIdle,
    setLocked,
    setShowCover,
    setCoverCircle,
    setCoverSpin,
    setIslandLines,
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

  const frame = useIslandFrame(ensureIslandWindowReady);

  const { hovered, edge, dragging, handlers } = useIslandInteraction({
    ensureWindowReady: ensureIslandWindowReady,
    frame,
    locked,
    caps,
    onTogglePlaying: togglePlaying,
  });
  const canToggle = hasTrack && caps.play_pause;

  useWordColouring({
    words: activeLineWords,
    wordRefs,
    baselineRef,
    isPlaying,
    pageVisible,
    surfaceVisible,
  });

  const hasArtwork = Boolean(artworkUrl) && !artworkError;
  const artSrc = hasArtwork ? (artworkUrl ?? TRANSPARENT_FALLBACK_ART) : TRANSPARENT_FALLBACK_ART;
  const panelState = resolveLyricsSurfaceState({
    booted: snapshotReady,
    hasTrack,
    lyricsStatus,
    hasContent: hasVisibleLyrics,
  });
  const showTrackIntro = shouldShowTrackIntro({
    snapshotReady,
    hasTrack,
    hasActiveLyric,
    trackTitle,
    lyricsStatus,
  });
  const barsActive = (panelState === 'ready' || showTrackIntro) && isPlaying;

  const activeContentKey = getActiveContentKey(activeLineWords, activeLine);
  const isCompactLayout = islandLines <= 1;
  const currentLineFallback = getCurrentLineFallback(activeLine, nextLine);
  const lineContent = renderLyricContent(activeLineWords, wordRefs, currentLineFallback);
  const panelContent = renderPanelContent({
    panelState,
    showTrackIntro,
    activeContentKey,
    hasActiveLyric,
    activeLineProgress,
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
  });

  return (
    <div
      ref={panelRef}
      className={`floating-panel ${locked ? 'locked' : 'unlocked'} ${frame?.docked ? 'docked' : 'floating'} ${panelState !== 'ready' && !showTrackIntro ? 'has-placeholder' : ''} ${isCompactLayout ? 'is-compact' : ''} ${hovered ? 'is-hovered' : ''} ${dragging ? 'is-dragging' : ''} ${transparency > 0.5 ? 'is-clear' : ''}`}
      style={{
        '--marquee-transparency': String(transparency),
        '--marquee-scale': String(frame?.scale ?? 1),
        '--marquee-notch-inset': `${frame?.notch_inset ?? 0}px`,
      } as CSSProperties}
      role="application"
      aria-label="Marquee"
      {...handlers}
    >
      <div className="island-background">
        <img src={artSrc} alt="" className="island-bg-img" decoding="async" onError={() => setArtworkError(true)} />
        <div className="island-bg-dimmer"></div>
      </div>

      <div className="panel-content">
        {showCover && (
          <div
            className="panel-art-container"
            style={{ position: 'relative', flexShrink: 0 }}
            data-island-action={caps.raise ? 'raise' : undefined}
          >
            <div className={`panel-art ${coverCircle ? 'is-circle' : ''} ${coverSpin ? 'is-spinning' : ''} ${isPlaying ? '' : 'is-paused'}`}>
              <img
                src={artSrc}
                className={`panel-cover ${hasArtwork ? '' : 'placeholder'}`}
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
                    <rect className="progress-ring-bg" x="2" y="2" width="40" height="40" rx="8" />
                    <rect className="progress-ring-fill rect-fill" x="2" y="2" width="40" height="40" rx="8" />
                  </>
                )}
              </svg>
            )}
          </div>
        )}

        <div className={`panel-lyrics-stack ${panelState !== 'ready' && !showTrackIntro ? 'is-placeholder' : ''}`}>
          {panelContent}
        </div>

        {/* The meter doubles as the play/pause control: on hover its bars
            fold away and the transport glyph takes their place. */}
        <div
          className={`island-meter ${canToggle ? 'can-toggle' : ''}`}
          data-island-action={canToggle ? 'toggle' : undefined}
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
          {canToggle && <TransportGlyph playing={isPlaying} className="island-glyph" />}
        </div>
      </div>

      {!locked && (
        <>
          <span
            className={`island-resize-handle is-left ${edge === -1 ? 'is-near' : ''}`}
            data-island-resize="left"
            aria-hidden="true"
          />
          <span
            className={`island-resize-handle is-right ${edge === 1 ? 'is-near' : ''}`}
            data-island-resize="right"
            aria-hidden="true"
          />
        </>
      )}
    </div>
  );
}
