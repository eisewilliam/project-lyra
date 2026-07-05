import { useRef, useState } from 'react';
import { GlidingLine } from '@/components/gliding-line';
import {
  isLyricsError,
  isLyricsNotFound,
  resolveLyricsSurfaceState,
} from '@/utils/lyrics-state';
import { KaraokePlaceholder } from './components/karaoke-placeholder';
import { usePageVisible } from '@/utils/use-page-visible';
import { useSurfaceAutoHide } from '@/hooks/use-surface-auto-hide';
import { useWordColouring } from '@/hooks/use-word-colouring';
import { makeWindowReady, applySurfaceVisible } from '@/utils/playback-sync';
import { useKaraokePlayback } from './hooks/use-karaoke-playback';
import { useKaraokeLayout } from './hooks/use-karaoke-layout';
import './karaoke.css';

applySurfaceVisible(false);

const SURFACE_LABEL = 'karaoke';
const ensureKaraokeWindowReady = makeWindowReady(SURFACE_LABEL);

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
    hasContent: hasVisibleLyrics,
  });

  const showTrackIntro =
    snapshotReady &&
    hasTrack &&
    !hasActiveLyric &&
    trackTitle.length > 0 &&
    !isLyricsError(lyricsStatus) &&
    !isLyricsNotFound(lyricsStatus);

  const activeContentKey = activeLineWords.length > 0
    ? activeLineWords.map((word) => `${word.start_ms}:${word.text}`).join('|')
    : activeLine || '';

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
  if (karaokeState === 'ready') {
    panelContent = (
      <>
        <GlidingLine
          key={activeContentKey}
          className={`karaoke-current ${activeLineWords.length > 0 ? 'has-word-sync' : ''}`}
          contentClassName="karaoke-lyric-content"
          contentKey={activeContentKey}
          syncProgress={activeLineProgress}
        >
          {lineContent}
        </GlidingLine>
        {lines >= 2 && (
          <div className="karaoke-next" key={nextLine || 'none'}>
            {nextLine === '' ? '♪' : (nextLine || '')}
          </div>
        )}
      </>
    );
  } else if (showTrackIntro) {
    panelContent = (
      <>
        <div className="karaoke-current is-track-intro">{trackTitle}</div>
        {lines >= 2 && trackArtist ? <div className="karaoke-next is-track-intro">{trackArtist}</div> : null}
      </>
    );
  } else {
    panelContent = <KaraokePlaceholder state={karaokeState} lines={lines} />;
  }

  return (
    <div className={`karaoke-root ${karaokeState !== 'ready' && !showTrackIntro ? 'is-placeholder' : ''}`}>
      {panelContent}
    </div>
  );
}
