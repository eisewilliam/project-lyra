import { useCallback, useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { AmbientBackground } from './components/ambient-background';
import { FirstRunCard } from './components/first-run-card';
import { MainLyricsPane } from './components/main-lyrics-pane';
import { PlayerSidebar } from './components/player-sidebar';
import { ShortcutHud } from './components/shortcut-hud';
import { useShortcutHud } from './hooks/use-shortcut-hud';
import { WindowControls } from './components/window-controls';
import type { ScreenEdgeMotionMap } from './types';
import { useLyricsPlayback } from './hooks/use-lyrics-playback';
import { useMainKeyboardShortcuts } from './hooks/use-main-keyboard-shortcuts';
import { useMainLyricReel } from './hooks/use-main-lyric-reel';
import { useMainProgressAndWordAnimation } from './hooks/use-main-progress-and-word-animation';
import { useTrackSkip, type SkipDirection } from './hooks/use-track-skip';
import { useLineMenu } from './hooks/use-line-menu';
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
  completeOnboarding,
  forceRefreshLyrics,
  getAutomationDenied,
  openAutomationSettings,
  nudgeLyricOffset,
  setBrowserLyrics,
  setLyricOffset,
  setPinnedApp,
  setTrackOverride,
} from '@/utils/tauri-commands';
import type { BrowserLyrics } from '@/types/tauri-contracts';
import { TRANSPARENT_FALLBACK_ART } from '@/utils/artwork';
import { noop } from './utils';
import './app.css';

const hostOs = detectHostOs();
const isWindows = hostOs === 'windows';
const isMac = hostOs === 'macos';
applyHostOsDataset();

function applyFloatingFont(scale: number) {
  // A missing value must not invalidate every calc() that uses the scale.
  document.documentElement.style.setProperty('--font-scale', String(Number.isFinite(scale) ? scale : 1));
}

applySurfaceVisible(false);

const NO_LINES: [] = [];
const AUTOMATION_CHECK_MS = 5000;

const openPrivacySettings = () => {
  openAutomationSettings().catch(noop);
};

const SURFACE_LABEL = 'main';
const ensureMainWindowReady = makeWindowReady(SURFACE_LABEL);

function App() {
  const {
    lyrics,
    plainLyrics,
    activeLine,
    isPlaying,
    togglePlaying,
    track,
    caps,
    ignoredMedia,
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
    isDragging,
  } = useLyricsPlayback({ ensureWindowReady: ensureMainWindowReady });

  const [surfaceVisible, setSurfaceVisible] = useState(false);
  const [hideWhenPaused, setHideWhenPaused] = useState(false);
  const [hideWhenIdle, setHideWhenIdle] = useState(false);
  const [karaokeMode, setKaraokeMode] = useState(false);
  // Assume onboarded until the UI state says otherwise, so existing installs
  // never flash the first-run card.
  const [onboarded, setOnboarded] = useState(true);
  const [automationDenied, setAutomationDenied] = useState<string[]>([]);
  const [showDelayControl, setShowDelayControl] = useState(false);
  const [selectValue, setSelectValue] = useState('');
  const [screenEdgeMotion, setScreenEdgeMotion] = useState<ScreenEdgeMotionMap>({});

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

  useSurfaceSettings({
    ensureWindowReady: ensureMainWindowReady,
    desiredVisibleRef,
    autoHiddenRef,
    setSurfaceVisible,
    setHideWhenPaused,
    setHideWhenIdle,
    getSurfaceVisible: (state) => state.floating_visible,
    onInitialUiState: (state) => {
      applyFloatingFont(state.floating_font_scale);
      setOnboarded(state.onboarded !== false);
    },
    onUiStateChange: (state) => {
      applyFloatingFont(state.floating_font_scale);
      setOnboarded(state.onboarded !== false);
    },
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

  const { paintRange, isBrowsing, returnToCurrent } = useMainLyricReel({
    activeLine,
    karaokeMode,
    lyricsCount: lyrics.length,
    lyricsPaneRef,
    lyricsContainerRef,
    lyricsRef,
    reelUriRef,
    setScreenEdgeMotion,
    trackUri,
  });

  const { skip, markSkip, switching } = useTrackSkip({
    trackUri,
    isPlaying,
    baselineRef,
  });
  const { hud, show: showShortcutHud } = useShortcutHud();

  useMainKeyboardShortcuts({
    track,
    caps,
    isPlaying,
    togglePlaying,
    baselineRef,
    setPositionMs,
    onSkip: skip,
    onFeedback: showShortcutHud,
  });

  // Skips sent from the macOS menu bar (⌘←/⌘→, Playback menu) or the
  // menu-bar menu still get the same dimming feedback.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void listen<SkipDirection>('transport-skip', (event) => {
      markSkip(event.payload);
      showShortcutHud(event.payload > 0 ? 'next' : 'previous');
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [markSkip, showShortcutHud]);

  const syncedLyrics = lyricsStatus === 'Ready' ? lyrics : NO_LINES;

  // Seeking from a line also ends free scrolling, so the reel follows again.
  const seekFromLine = useCallback((index: number, ts: number) => {
    returnToCurrent();
    seekToLine(index, ts);
  }, [returnToCurrent, seekToLine]);

  const openLineMenu = useLineMenu({
    lyrics: syncedLyrics,
    plainLyrics,
    canSeek: caps.seek,
    seekToLine: seekFromLine,
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
    isDragging,
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

  const handleArtworkError = useCallback(() => {
    setArtworkError(true);
  }, [setArtworkError]);

  const chooseBrowserLyrics = useCallback((choice: BrowserLyrics) => {
    setBrowserLyrics(choice).catch(noop);
  }, []);

  const ignoredTrackKey = ignoredMedia?.track_key ?? null;
  const followIgnored = useCallback(() => {
    if (ignoredTrackKey) setTrackOverride(ignoredTrackKey, true).catch(noop);
  }, [ignoredTrackKey]);

  const followAutomatically = useCallback(() => {
    setPinnedApp(null).catch(noop);
  }, []);

  const trackKey = track?.uri ?? null;
  const markNotMusic = useCallback(() => {
    if (trackKey) setTrackOverride(trackKey, false).catch(noop);
  }, [trackKey]);

  // While nothing is followed, check whether macOS refused Automation access
  // so the empty state can say why and where to allow it.
  useEffect(() => {
    if (!isMac || !onboarded || hasTrack) return;
    let cancelled = false;
    const check = () => {
      getAutomationDenied()
        .then((list) => {
          if (!cancelled) setAutomationDenied(list);
        })
        .catch(noop);
    };
    check();
    const timer = globalThis.setInterval(check, AUTOMATION_CHECK_MS);
    return () => {
      cancelled = true;
      globalThis.clearInterval(timer);
    };
  }, [hasTrack, onboarded]);

  const finishOnboarding = useCallback(() => {
    setOnboarded(true);
    completeOnboarding().catch(noop);
  }, []);

  const retryLyrics = useCallback(() => {
    refreshedUriForRetry.current = '';
    forceRefreshLyrics().catch(noop);
  }, []);

  const nudgeOffset = useCallback((deltaMs: number) => {
    nudgeLyricOffset(deltaMs)
      .then((ms) => setLyricOffsetMs(ms))
      .catch(noop);
  }, [setLyricOffsetMs]);

  const resetOffset = useCallback(() => {
    setLyricOffset(0)
      .then((ms) => setLyricOffsetMs(ms))
      .catch(noop);
  }, [setLyricOffsetMs]);

  const offsetLabel = `${lyricOffsetMs > 0 ? '+' : ''}${lyricOffsetMs} ms`;

  return (
    <main className="lyra-window">
      {isWindows && <WindowControls />}

      <AmbientBackground
        artworkSrc={artworkSrc}
        onArtworkError={handleArtworkError}
      />

      <PlayerSidebar
        hasSyncedLyrics={lyricsStatus === 'Ready'}
        artworkError={artworkError}
        artworkSrc={artworkSrc}
        baselineRef={baselineRef}
        caps={caps}
        clampedPositionMs={clampedPositionMs}
        durationMs={durationMs}
        handleMouseDown={handleMouseDown}
        hasArtwork={hasArtwork}
        hasTrack={hasTrack}
        isPlaying={isPlaying}
        lyricOffsetMs={lyricOffsetMs}
        offsetLabel={offsetLabel}
        onArtworkError={handleArtworkError}
        onNudgeOffset={nudgeOffset}
        onResetOffset={resetOffset}
        onRetryLyrics={retryLyrics}
        positionLabelRef={positionLabelRef}
        progressFillRef={progressFillRef}
        progressPct={progressPct}
        progressTrackRef={progressTrackRef}
        selectValue={selectValue}
        togglePlaying={togglePlaying}
        onMarkNotMusic={markNotMusic}
        setPositionMs={setPositionMs}
        setSelectValue={setSelectValue}
        setShowDelayControl={setShowDelayControl}
        showDelayControl={showDelayControl && lyricsStatus === 'Ready'}
        snapshotReady={snapshotReady}
        track={track}
        lyrics={syncedLyrics}
        onSkip={skip}
      />

      <MainLyricsPane
        activeLine={activeLine}
        activeLineWords={activeLineWords}
        karaokeMode={karaokeMode}
        lyrics={syncedLyrics}
        plainLyrics={plainLyrics}
        lyricsContainerRef={lyricsContainerRef}
        lyricsPaneRef={lyricsPaneRef}
        lyricsRef={lyricsRef}
        lyricsViewState={lyricsViewState}
        notFoundReason={notFoundReason}
        onBrowserLyrics={chooseBrowserLyrics}
        ignoredMedia={ignoredMedia}
        onFollowIgnored={followIgnored}
        onFollowAutomatically={followAutomatically}
        paintRange={paintRange}
        screenEdgeMotion={screenEdgeMotion}
        {...(canRetry ? { onRetryLyrics: retryLyrics } : {})}
        seekToLine={seekFromLine}
        wordRefs={wordRefs}
        isBrowsing={isBrowsing}
        onReturnToCurrent={returnToCurrent}
        switching={switching}
        onLineMenu={openLineMenu}
        automationDenied={automationDenied}
        onOpenAutomationSettings={openPrivacySettings}
      />

      <ShortcutHud hud={hud} />
      {isMac && !onboarded && <FirstRunCard onContinue={finishOnboarding} />}
    </main>
  );
}

export default App;
