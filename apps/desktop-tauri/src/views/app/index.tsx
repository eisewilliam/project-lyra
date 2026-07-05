import { useRef, useState } from 'react';
import { AmbientBackground } from './components/ambient-background';
import { MainLyricsPane } from './components/main-lyrics-pane';
import { PlayerSidebar } from './components/player-sidebar';
import { WindowControls } from './components/window-controls';
import { useLyricsPlayback } from './hooks/use-lyrics-playback';
import { useMainLyricReel } from './hooks/use-main-lyric-reel';
import { useMainProgressAndWordAnimation } from './hooks/use-main-progress-and-word-animation';
import { useResizeVibrancy } from './hooks/use-resize-vibrancy';
import {
  getNotFoundReason,
  isLyricsNotFound,
  isRetryableNotFound,
  resolveLyricsSurfaceState,
} from '@/utils/lyrics-state';
import { applyHostOsDataset, detectHostOs } from '@/utils/os';
import { usePageVisible } from '@/utils/use-page-visible';
import { useArtworkFallback } from '@/hooks/use-artwork-fallback';
import { useSurfaceAutoHide } from '@/hooks/use-surface-auto-hide';
import { useSurfaceSettings } from '@/hooks/use-surface-settings';
import {
  makeWindowReady,
  applySurfaceVisible,
} from '@/utils/playback-sync';
import {
  forceRefreshLyrics,
  nudgeLyricOffset,
  setLyricOffset,
} from '@/utils/tauri-commands';
import { TRANSPARENT_FALLBACK_ART } from '@/utils/artwork';
import { noop } from './utils';
import './app.css';

const hostOs = detectHostOs();
const isWindows = hostOs === 'windows';
applyHostOsDataset();

function applyFloatingFont(scale: number) {
  document.documentElement.style.setProperty('--font-scale', String(scale));
}

applySurfaceVisible(false);

const SURFACE_LABEL = 'main';
const ensureMainWindowReady = makeWindowReady(SURFACE_LABEL);

function App() {
  const {
    lyrics,
    activeLine,
    isPlaying,
    setIsPlaying,
    track,
    lyricsStatus,
    snapshotReady,
    positionMs,
    setPositionMs,
    activeLineWords,
    lyricOffsetMs,
    setLyricOffsetMs,
    baselineRef,
    lyricsRef,
    wordRefs,
    progressTrackRef,
    progressFillRef,
    positionLabelRef,
    handleMouseDown,
    seekToLine,
  } = useLyricsPlayback({ ensureWindowReady: ensureMainWindowReady });

  const [surfaceVisible, setSurfaceVisible] = useState(false);
  const [hideWhenPaused, setHideWhenPaused] = useState(false);
  const [hideWhenIdle, setHideWhenIdle] = useState(false);
  const [karaokeMode, setKaraokeMode] = useState(false);
  const [showDelayControl, setShowDelayControl] = useState(false);
  const [selectValue, setSelectValue] = useState('');

  const lyricsPaneRef = useRef<HTMLElement | null>(null);
  const lyricsContainerRef = useRef<HTMLDivElement | null>(null);
  const reelUriRef = useRef('');
  const refreshedUriForRetry = useRef('');

  const desiredVisibleRef = useRef(true);
  const autoHiddenRef = useRef(false);

  const trackUri = track?.uri ?? '';
  const durationMs = track?.duration_ms ?? 0;
  const { artworkError, setArtworkError } = useArtworkFallback(trackUri);

  const pageVisible = usePageVisible();

  useResizeVibrancy();

  useSurfaceSettings({
    ensureWindowReady: ensureMainWindowReady,
    desiredVisibleRef,
    autoHiddenRef,
    setSurfaceVisible,
    setHideWhenPaused,
    setHideWhenIdle,
    getSurfaceVisible: (state) => state.floating_visible,
    onInitialUiState: (state) => applyFloatingFont(state.floating_font_scale),
    onUiStateChange: (state) => applyFloatingFont(state.floating_font_scale),
    onAppSettings: (settings) => setKaraokeMode(settings.behavior.karaoke_mode),
    shouldReleaseAutoHide: (settings) => !settings.behavior.hide_when_paused,
  });

  useSurfaceAutoHide({
    snapshotReady,
    hideWhenPaused,
    hideWhenIdle,
    isPlaying,
    hasTrack: Boolean(track),
    desiredVisibleRef,
    autoHiddenRef,
    setSurfaceVisible,
  });

  useMainLyricReel({
    activeLine,
    karaokeMode,
    lyricsCount: lyrics.length,
    lyricsPaneRef,
    lyricsContainerRef,
    lyricsRef,
    reelUriRef,
    trackUri,
  });

  useMainProgressAndWordAnimation({
    activeLineWords,
    baselineRef,
    durationMs,
    isPlaying,
    pageVisible,
    positionLabelRef,
    progressFillRef,
    surfaceVisible,
    wordRefs,
  });

  const hasTrack = Boolean(track);
  const hasArtwork = Boolean(track?.artwork_url) && !artworkError;
  const artworkSrc = hasArtwork ? (track?.artwork_url ?? TRANSPARENT_FALLBACK_ART) : TRANSPARENT_FALLBACK_ART;
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
    refreshedUriForRetry.current = '';
    forceRefreshLyrics().catch(noop);
  }

  function nudgeOffset(deltaMs: number) {
    nudgeLyricOffset(deltaMs)
      .then((ms) => setLyricOffsetMs(ms))
      .catch(noop);
  }

  function resetOffset() {
    setLyricOffset(0)
      .then((ms) => setLyricOffsetMs(ms))
      .catch(noop);
  }

  const offsetLabel = `${lyricOffsetMs > 0 ? '+' : ''}${lyricOffsetMs} ms`;

  return (
    <main className="lyra-window">
      {isWindows && <WindowControls />}

      <AmbientBackground
        artworkSrc={artworkSrc}
        onArtworkError={() => setArtworkError(true)}
      />

      <PlayerSidebar
        artworkError={artworkError}
        artworkSrc={artworkSrc}
        baselineRef={baselineRef}
        clampedPositionMs={clampedPositionMs}
        durationMs={durationMs}
        handleMouseDown={handleMouseDown}
        hasArtwork={hasArtwork}
        hasTrack={hasTrack}
        isPlaying={isPlaying}
        lyricOffsetMs={lyricOffsetMs}
        offsetLabel={offsetLabel}
        onArtworkError={() => setArtworkError(true)}
        onNudgeOffset={nudgeOffset}
        onResetOffset={resetOffset}
        onRetryLyrics={retryLyrics}
        positionLabelRef={positionLabelRef}
        progressFillRef={progressFillRef}
        progressPct={progressPct}
        progressTrackRef={progressTrackRef}
        selectValue={selectValue}
        setIsPlaying={setIsPlaying}
        setPositionMs={setPositionMs}
        setSelectValue={setSelectValue}
        setShowDelayControl={setShowDelayControl}
        showDelayControl={showDelayControl}
        snapshotReady={snapshotReady}
        track={track}
      />

      <MainLyricsPane
        activeLine={activeLine}
        activeLineWords={activeLineWords}
        karaokeMode={karaokeMode}
        lyrics={lyrics}
        lyricsContainerRef={lyricsContainerRef}
        lyricsPaneRef={lyricsPaneRef}
        lyricsRef={lyricsRef}
        lyricsViewState={lyricsViewState}
        notFoundReason={notFoundReason}
        {...(canRetry ? { onRetryLyrics: retryLyrics } : {})}
        seekToLine={seekToLine}
        wordRefs={wordRefs}
      />
    </main>
  );
}

export default App;
