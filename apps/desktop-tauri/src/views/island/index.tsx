import { useRef, useState, type CSSProperties } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { GlidingLine } from '@/components/gliding-line';
import {
  isLyricsError,
  isLyricsNotFound,
  resolveLyricsSurfaceState,
} from '@/utils/lyrics-state';
import { PanelPlaceholder } from './components/panel-placeholder';
import { usePageVisible } from '@/utils/use-page-visible';
import { useArtworkFallback } from '@/hooks/use-artwork-fallback';
import { useSurfaceAutoHide } from '@/hooks/use-surface-auto-hide';
import { useWordColouring } from '@/hooks/use-word-colouring';
import { makeWindowReady, applySurfaceVisible } from '@/utils/playback-sync';
import { useIslandMove } from './hooks/use-island-move';
import { useAudioVisualizer } from './hooks/use-audio-visualizer';
import { useProgressRing } from './hooks/use-progress-ring';
import { useIslandPlayback } from './hooks/use-island-playback';
import { useIslandSettings } from './hooks/use-island-settings';
import { TRANSPARENT_FALLBACK_ART } from '@/utils/artwork';
import './island.css';

const noop = (...args: unknown[]) => { if (args) return; };

const SURFACE_LABEL = 'island';
const ensureIslandWindowReady = makeWindowReady(SURFACE_LABEL);
const BAR_KEYS = ['bar-left-outer', 'bar-left-inner', 'bar-right-inner', 'bar-right-outer'] as const;

applySurfaceVisible(false);

export default function Island() {
  const [locked, setLocked] = useState(true);
  const [isDocked, setIsDocked] = useState(true);
  const [showCover, setShowCover] = useState(true);
  const [coverCircle, setCoverCircle] = useState(false);
  const [coverSpin, setCoverSpin] = useState(false);
  const [surfaceVisible, setSurfaceVisible] = useState(false);
  const [islandHeight, setIslandHeight] = useState(72);
  const [hideWhenPaused, setHideWhenPaused] = useState(false);
  const [hideWhenIdle, setHideWhenIdle] = useState(false);

  const {
    activeLine,
    nextLine,
    artworkUrl,
    trackTitle,
    trackArtist,
    hasTrack,
    hasVisibleLyrics,
    isPlaying,
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

  const progressRingRef = useRef<SVGSVGElement | null>(null);
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
    setIslandHeight,
    setIsDocked,
  });

  useIslandMove({
    ensureWindowReady: ensureIslandWindowReady,
    setIsDocked,
    setLocked,
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

  useAudioVisualizer({
    isPlaying,
    pageVisible,
    surfaceVisible,
    trackKey,
    trackTitle,
    trackArtist,
    activeLineProgress,
    activeLineWords,
    visualizerRefs,
    baselineRef,
  });

  useProgressRing({
    isPlaying,
    durationMs,
    pageVisible,
    surfaceVisible,
    progressRingRef,
    baselineRef,
  });

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
  const showTrackIntro =
    snapshotReady &&
    hasTrack &&
    !hasActiveLyric &&
    trackTitle.length > 0 &&
    !isLyricsError(lyricsStatus) &&
    !isLyricsNotFound(lyricsStatus);
  const barsActive = (panelState === 'ready' || showTrackIntro) && isPlaying;

  const activeContentKey = activeLineWords.length > 0
    ? activeLineWords.map((word) => `${word.start_ms}:${word.text}`).join('|')
    : activeLine || '';

  const isCompactLayout = islandHeight <= 64;

  const defaultText = activeLine || (nextLine === null ? '' : '♪');
  const lineContent = activeLineWords.length > 0 ? (
    activeLineWords.map((w, i) => (
      <span
        key={`${w.start_ms}-${w.text}`}
        ref={(el) => {
          if (wordRefs.current) {
            wordRefs.current[i] = el;
          }
        }}
        className="lyric-word upcoming"
      >{w.text}</span>
    ))
  ) : defaultText;

  let panelContent: React.ReactNode;
  if (panelState === 'ready') {
    panelContent = (
      <>
        <GlidingLine
          key={activeContentKey}
          className={`panel-lyric-active ${hasActiveLyric ? '' : 'is-preroll'}`}
          contentClassName="panel-lyric-content"
          contentKey={activeContentKey}
          syncProgress={activeLineProgress}
        >
          {lineContent}
        </GlidingLine>
        <div className="panel-lyric-next" key={nextLine || 'none'}>
          {nextLine === '' ? '♪' : (nextLine || '')}
        </div>
      </>
    );
  } else if (showTrackIntro) {
    panelContent = (
      <>
        <div className="panel-lyric-active is-track-intro">{trackTitle}</div>
        <div className="panel-lyric-next is-track-intro">{trackArtist}</div>
      </>
    );
  } else {
    panelContent = <PanelPlaceholder state={panelState} />;
  }

  return (
    <div
      className={`floating-panel ${locked ? 'locked' : 'unlocked'} ${isDocked ? 'docked' : 'floating'} ${panelState !== 'ready' && !showTrackIntro ? 'has-placeholder' : ''} ${isCompactLayout ? 'is-compact' : ''}`}
      onMouseDown={(e) => {
        if (locked || e.button !== 0) return;
        e.preventDefault();
        getCurrentWindow().startDragging().catch(noop);
      }}
      role="application"
      aria-label="Dynamic Island panel"
    >
      <div className="island-background">
        <img src={artSrc} alt="" className="island-bg-img" decoding="async" onError={() => setArtworkError(true)} />
        <div className="island-bg-dimmer"></div>
      </div>

      <div className="panel-content">
        {showCover && (
          <div className="panel-art-container" style={{ position: 'relative', flexShrink: 0 }}>
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
              <svg ref={progressRingRef} className="progress-ring-svg" viewBox="0 0 44 44">
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
                  '--meter-height': '3px',
                  '--meter-opacity': '0.36',
                } as CSSProperties}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
