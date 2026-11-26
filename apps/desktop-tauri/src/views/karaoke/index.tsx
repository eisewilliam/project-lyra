import { useEffect, useRef, useState, type ReactNode } from 'react';
import { GlidingLine, type GlideClock } from '@/components/gliding-line';
import { VocalCountdown } from '@/components/vocal-countdown';
import {
  resolveLyricsSurfaceState,
  type LyricsPlaceholderState,
} from '@/utils/lyrics-state';
import type { LyricWord, VocalCue } from '@/types/tauri-contracts';
import {
  shouldShowTrackIntro,
  getActiveContentKey,
  getCurrentLineFallback,
  getNextLineText,
  renderLyricContent,
} from '@/utils/lyric-renderer';
import { KaraokePlaceholder } from './components/placeholder';
import { usePageVisible } from '@/utils/use-page-visible';
import { useSurfaceAutoHide } from '@/hooks/use-surface-auto-hide';
import { useWordColouring } from '@/hooks/use-word-colouring';
import { makeWindowReady } from '@/utils/playback-sync';
import { useKaraokePlayback } from './hooks/use-playback';
import { useKaraokeLayout } from './hooks/use-layout';
import './karaoke.css';

const SURFACE_LABEL = 'karaoke';
const ensureKaraokeWindowReady = makeWindowReady(SURFACE_LABEL);



function renderKaraokeContent({
  karaokeState,
  vocalCue,
  showTrackIntro,
  activeContentKey,
  activeLineWords,
  activeLineProgress,
  glideClock,
  lineContent,
  outgoingLine,
  onOutgoingDone,
  lines,
  nextLine,
  trackTitle,
  trackArtist,
}: Readonly<{
  karaokeState: LyricsPlaceholderState;
  vocalCue: VocalCue | null;
  showTrackIntro: boolean;
  activeContentKey: string;
  activeLineWords: LyricWord[];
  activeLineProgress: number;
  glideClock: GlideClock;
  lineContent: ReactNode;
  outgoingLine: { key: string; text: string } | null;
  onOutgoingDone: () => void;
  lines: number;
  nextLine: string | null;
  trackTitle: string;
  trackArtist: string;
}>): ReactNode {
  if (vocalCue) {
    return (
      <>
        <div className="karaoke-current is-vocal-cue"><VocalCountdown seconds={vocalCue.seconds} /></div>
        {lines >= 2 && vocalCue.next_line && (
          <div className="karaoke-next" key={vocalCue.next_line}>{vocalCue.next_line}</div>
        )}
      </>
    );
  }

  if (karaokeState === 'ready') {
    return (
      <>
        <div className="karaoke-current-stage">
          {outgoingLine && (
            <div
              key={outgoingLine.key}
              className="karaoke-current karaoke-outgoing"
              aria-hidden="true"
              onAnimationEnd={onOutgoingDone}
            >
              {outgoingLine.text}
            </div>
          )}
          <GlidingLine
            key={activeContentKey}
            className={`karaoke-current ${activeLineWords.length > 0 ? 'has-word-sync' : ''}`}
            contentClassName="karaoke-lyric-content"
            contentKey={activeContentKey}
            syncProgress={activeLineProgress}
            clock={glideClock}
          >
            {lineContent}
          </GlidingLine>
        </div>
        {lines >= 2 && nextLine !== null && (
          <div className="karaoke-next" key={nextLine || 'none'}>
            {getNextLineText(nextLine)}
          </div>
        )}
      </>
    );
  }

  if (showTrackIntro) {
    return (
      <>
        <div className="karaoke-current is-track-intro">{trackTitle}</div>
        {lines >= 2 && trackArtist ? <div className="karaoke-next is-track-intro">{trackArtist}</div> : null}
      </>
    );
  }

  return <KaraokePlaceholder state={karaokeState} lines={lines} />;
}

export default function Karaoke() {
  const [surfaceVisible, setSurfaceVisible] = useState(false);
  const [hideWhenPaused, setHideWhenPaused] = useState(false);
  const [hideWhenIdle, setHideWhenIdle] = useState(false);

  const desiredVisibleRef = useRef(true);
  const autoHiddenRef = useRef(false);
  const pageVisible = usePageVisible();

  const lines = useKaraokeLayout({
    ensureWindowReady: ensureKaraokeWindowReady,
    desiredVisibleRef,
    autoHiddenRef,
    setSurfaceVisible,
    setHideWhenPaused,
    setHideWhenIdle,
  });

  const {
    activeLine,
    vocalCue,
    nextLine,
    activeLineProgress,
    trackTitle,
    trackArtist,
    hasTrack,
    hasVisibleLyrics,
    hasActiveLyric,
    lyricsStatus,
    snapshotReady,
    activeLineWords,
    isPlaying,
    baselineRef,
    wordRefs,
  } = useKaraokePlayback({ ensureWindowReady: ensureKaraokeWindowReady });

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

  useWordColouring({
    words: activeLineWords,
    wordRefs,
    baselineRef,
    isPlaying,
    pageVisible,
    surfaceVisible,
  });

  const karaokeState = resolveLyricsSurfaceState({
    booted: snapshotReady,
    hasTrack,
    lyricsStatus,
    hasContent: hasVisibleLyrics || vocalCue !== null,
  });

  const showTrackIntro = shouldShowTrackIntro({
    snapshotReady,
    hasTrack,
    hasActiveLyric,
    trackTitle,
    lyricsStatus,
  });

  const activeContentKey = getActiveContentKey(activeLineWords, activeLine);
  const currentLineFallback = getCurrentLineFallback(activeLine, nextLine);
  const showingLyricLine = karaokeState === 'ready' && vocalCue === null;
  const currentActiveText = showingLyricLine ? currentLineFallback : '';
  const [lineSwap, setLineSwap] = useState({
    key: activeContentKey,
    text: currentActiveText,
    outgoingKey: '',
    outgoingText: '',
  });
  if (lineSwap.key !== activeContentKey || (!showingLyricLine && (lineSwap.text || lineSwap.outgoingText))) {
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const lowPower = document.documentElement.dataset.lowPower === 'true';
    const hidden = document.documentElement.dataset.surfaceVisible === 'false';
    const canHandoff = showingLyricLine
      && Boolean(lineSwap.text)
      && Boolean(currentActiveText)
      && lineSwap.text !== currentActiveText
      && !reduce
      && !lowPower
      && !hidden;
    setLineSwap({
      key: activeContentKey,
      text: currentActiveText,
      outgoingKey: canHandoff ? `${lineSwap.key}-out` : '',
      outgoingText: canHandoff ? lineSwap.text : '',
    });
  } else if (lineSwap.text !== currentActiveText) {
    setLineSwap((cur) => ({ ...cur, text: currentActiveText }));
  }

  useEffect(() => {
    if (!lineSwap.outgoingText) return;
    const timer = globalThis.setTimeout(() => {
      setLineSwap((cur) => (cur.outgoingText ? { ...cur, outgoingKey: '', outgoingText: '' } : cur));
    }, 240);
    return () => globalThis.clearTimeout(timer);
  }, [lineSwap.outgoingKey, lineSwap.outgoingText]);

  const lineContent = renderLyricContent(activeLineWords, wordRefs, currentLineFallback);
  const panelContent = renderKaraokeContent({
    karaokeState,
    vocalCue,
    showTrackIntro,
    activeContentKey,
    activeLineWords,
    activeLineProgress,
    glideClock: {
      words: activeLineWords,
      baselineRef,
      isPlaying,
      running: pageVisible && surfaceVisible,
    },
    lineContent,
    outgoingLine: lineSwap.outgoingText
      ? { key: lineSwap.outgoingKey, text: lineSwap.outgoingText }
      : null,
    onOutgoingDone: () => setLineSwap((cur) => (cur.outgoingText ? { ...cur, outgoingKey: '', outgoingText: '' } : cur)),
    lines,
    nextLine,
    trackTitle,
    trackArtist,
  });

  return (
    <div className={`karaoke-root ${karaokeState !== 'ready' && !showTrackIntro ? 'is-placeholder' : ''}`}>
      {panelContent}
    </div>
  );
}
