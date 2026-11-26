import { useCallback, useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { AmbientBackground } from './components/ambient-background';
import { ChooseLyricsPanel } from './components/choose-lyrics-panel';
import { LyricMaker } from './components/lyric-maker';
import { FindLyricsPanel } from './components/find-lyrics-panel';
import { VocalCountdown } from '@/components/vocal-countdown';
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
import { useMainWindowReveal } from './hooks/use-main-window-reveal';
import {
  canSearchLyricsAgain,
  getNotFoundReason,
  isLyricsNotFound,
  resolveLyricsSurfaceState,
} from '@/utils/lyrics-state';
import { applyHostOsDataset, detectHostOs } from '@/utils/os';
import { usePageVisible } from '@/utils/use-page-visible';
import { useArtworkFallback } from '@/hooks/use-artwork-fallback';
import { useExitPresence } from '@/hooks/use-exit-presence';
import { useSurfaceAutoHide } from '@/hooks/use-surface-auto-hide';
import { useSurfaceSettings } from '@/hooks/use-surface-settings';
import { makeWindowReady } from '@/utils/playback-sync';
import {
  completeOnboarding,
  forceRefreshLyrics,
  getAutomationDenied,
  importLyricsFile,
  openAutomationSettings,
  nudgeLyricOffset,
  resetLyricsChoice,
  setBrowserLyrics,
  setLyricOffset,
  setPinnedApp,
  setTrackOverride,
} from '@/utils/tauri-commands';
import type { BrowserLyrics } from '@/types/tauri-contracts';
import { TRANSPARENT_FALLBACK_ART } from '@/utils/artwork';
import type { TrackRef } from '@/types/tauri-contracts';
import { noop, pulseProgressTrack } from './utils';
import { SyncNudge } from './components/sync-nudge';
import './app.css';

const hostOs = detectHostOs();
// Windows and Linux windows have no native title bar, so they draw their own
// minimize, maximize and close buttons.
const drawsWindowControls = hostOs !== 'macos';
const isMac = hostOs === 'macos';
applyHostOsDataset();

function applyFloatingFont(scale: number) {
  // A missing value must not invalidate every calc() that uses the scale.
  document.documentElement.style.setProperty('--font-scale', String(Number.isFinite(scale) ? scale : 1));
}

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
    lyricsOrigin,
    snapshotReady,
    hasPosition,
    timingClock,
    positionMs,
    setPositionMs,
    activeLineWords,
    lyricOffsetMs,
    vocalCountdown,
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
  const [syncTrackUri, setSyncTrackUri] = useState<string | null>(null);
  // The track the lyrics chooser was opened for; it closes when that track
  // stops playing, unless the user has unsaved timing work in LyricMaker.
  const [maker, setMaker] = useState<{ track: TrackRef; plain: string; saved: boolean } | null>(null);
  const [makerDirty, setMakerDirty] = useState(false);
  const [chooserUri, setChooserUri] = useState<string | null>(null);
  const [pendingChooserUri, setPendingChooserUri] = useState<string | null>(null);
  const [finderUri, setFinderUri] = useState<string | null>(null);
  const [finderFocus, setFinderFocus] = useState(0);
  const [screenEdgeMotion, setScreenEdgeMotion] = useState<ScreenEdgeMotionMap>({});

  const windowRef = useRef<HTMLElement | null>(null);
  const revealRimRef = useRef<HTMLDivElement | null>(null);
  const lyricsPaneRef = useRef<HTMLElement | null>(null);
  const trackActionsRef = useRef<HTMLButtonElement>(null);
  const lyricsPanelOpenerRef = useRef<HTMLElement | null>(null);
  const lyricsContainerRef = useRef<HTMLDivElement | null>(null);
  const pendingChooserTimerRef = useRef<number | null>(null);
  const reelUriRef = useRef('');
  const refreshedUriForRetry = useRef('');

  useMainWindowReveal({ windowRef, rimRef: revealRimRef });

  const desiredVisibleRef = useRef(true);
  const autoHiddenRef = useRef(false);

  const trackUri = track?.uri ?? '';
  if (maker && maker.track.uri !== trackUri && !makerDirty) setMaker(null);
  if (syncTrackUri !== null && (syncTrackUri !== trackUri || lyricsStatus !== 'Ready')) setSyncTrackUri(null);
  if (chooserUri !== null && chooserUri !== trackUri) setChooserUri(null);
  if (pendingChooserUri !== null && onboarded && pendingChooserUri === trackUri) {
    setPendingChooserUri(null);
    setSyncTrackUri(null);
    setFinderUri(null);
    setMaker(null);
    setChooserUri(trackUri);
  }
  const chooserOpen = chooserUri === trackUri;
  if (finderUri !== null && finderUri !== trackUri) setFinderUri(null);
  const canFind = Boolean(trackUri) && (
    (lyricsStatus === 'Ready' && lyrics.length > 0) || (lyricsStatus === 'Unsynced' && Boolean(plainLyrics))
  );
  const rememberLyricsPanelOpener = useCallback((opener?: HTMLElement | null) => {
    const focused = opener ?? document.activeElement;
    lyricsPanelOpenerRef.current = focused instanceof HTMLElement && focused !== document.body
      ? focused
      : lyricsPaneRef.current;
  }, []);
  const restoreLyricsPanelFocus = useCallback(() => {
    const opener = lyricsPanelOpenerRef.current;
    lyricsPanelOpenerRef.current = null;
    requestAnimationFrame(() => {
      if (document.activeElement === document.body) {
        const target = opener?.isConnected ? opener : lyricsPaneRef.current;
        target?.focus({ preventScroll: true });
      }
    });
  }, []);
  const openMaker = (saved: boolean, opener?: HTMLElement) => {
    if (!track) return;
    rememberLyricsPanelOpener(saved ? trackActionsRef.current : opener);
    setSyncTrackUri(null);
    setChooserUri(null);
    setPendingChooserUri(null);
    setFinderUri(null);
    setMakerDirty(false);
    setMaker({ track, plain: plainLyrics ?? '', saved });
  };
  const openFinder = useCallback((opener?: HTMLElement | null) => {
    setMaker(null);
    if (finderUri !== trackUri) rememberLyricsPanelOpener(opener);
    setSyncTrackUri(null);
    setChooserUri(null);
    setPendingChooserUri(null);
    setFinderUri(trackUri);
    setFinderFocus((previous) => previous + 1);
  }, [finderUri, rememberLyricsPanelOpener, trackUri]);
  const openFinderFromTrack = useCallback(() => openFinder(trackActionsRef.current), [openFinder]);
  const closeFinder = useCallback(() => {
    setFinderUri(null);
    restoreLyricsPanelFocus();
  }, [restoreLyricsPanelFocus]);
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

  const { paintRange, isBrowsing, returnToCurrent, scrollToLine } = useMainLyricReel({
    activeLine,
    karaokeMode,
    lyricsCount: chooserOpen ? 0 : lyrics.length,
    lyricsPaneRef,
    lyricsContainerRef,
    lyricsRef,
    reelUriRef,
    setScreenEdgeMotion,
    trackUri,
  });

  const { skip, markSkip, switching, skipDirection } = useTrackSkip({
    trackUri,
    isPlaying,
    baselineRef,
  });
  const { hud, show: showShortcutHud } = useShortcutHud();
  const handleSeekPulse = useCallback(() => {
    pulseProgressTrack(progressTrackRef.current);
  }, [progressTrackRef]);

  useMainKeyboardShortcuts({
    track: maker ? null : track,
    caps,
    isPlaying,
    togglePlaying,
    baselineRef,
    setPositionMs,
    onSkip: skip,
    onFeedback: showShortcutHud,
    onSeekPulse: handleSeekPulse,
    onFind: !maker && canFind && chooserUri === null && onboarded ? openFinder : null,
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

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void listen<string>('open-choose-lyrics', (event) => {
      const target = event.payload;
      if (!target) return;
      returnToCurrent();
      setPendingChooserUri(target);
      if (pendingChooserTimerRef.current !== null) {
        globalThis.clearTimeout(pendingChooserTimerRef.current);
      }
      pendingChooserTimerRef.current = globalThis.setTimeout(() => {
        pendingChooserTimerRef.current = null;
        setPendingChooserUri((current) => (current === target ? null : current));
      }, 3000);
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });
    return () => {
      cancelled = true;
      unlisten?.();
      if (pendingChooserTimerRef.current !== null) {
        globalThis.clearTimeout(pendingChooserTimerRef.current);
        pendingChooserTimerRef.current = null;
      }
    };
  }, [returnToCurrent]);

  const syncedLyrics = lyricsStatus === 'Ready' ? lyrics : NO_LINES;

  // Seeking from a line also ends free scrolling, so the reel follows again.
  const seekFromLine = useCallback((index: number, ts: number) => {
    returnToCurrent();
    seekToLine(index, ts);
  }, [returnToCurrent, seekToLine]);

  const handleLineCopied = useCallback((kind: 'copied-line' | 'copied-all', lineIndex: number | null) => {
    showShortcutHud(kind);
    if (lineIndex === null) return;
    if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const lineEl = lyricsRef.current[lineIndex];
    if (!lineEl) return;
    lineEl.getAnimations().forEach((a) => a.cancel());
    lineEl.animate(
      [
        { opacity: '1', filter: 'brightness(1.35)' },
        { opacity: '0.88', filter: 'brightness(1)', offset: 0.45 },
        { opacity: '1', filter: 'brightness(1)' },
      ],
      { duration: 320, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
    );
  }, [lyricsRef, showShortcutHud]);

  const openLineMenu = useLineMenu({
    lyrics: syncedLyrics,
    plainLyrics,
    canSeek: caps.seek,
    seekToLine: seekFromLine,
    onCopied: handleLineCopied,
  });

  useMainProgressAndWordAnimation({
    activeLineWords,
    baselineRef,
    durationMs,
    isPlaying,
    pageVisible,
    positionLabelRef,
    progressFillRef,
    progressTrackRef,
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
  const canRetry = hasTrack && canSearchLyricsAgain(lyricsStatus);

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

  const openChooser = useCallback((opener?: HTMLElement | null) => {
    if (!trackUri) return;
    rememberLyricsPanelOpener(opener);
    setSyncTrackUri(null);
    setFinderUri(null);
    returnToCurrent();
    setMaker(null);
    setChooserUri(trackUri);
  }, [rememberLyricsPanelOpener, returnToCurrent, trackUri]);
  const openChooserFromTrack = useCallback(() => openChooser(trackActionsRef.current), [openChooser]);
  const closeChooser = useCallback(() => {
    setPendingChooserUri(null);
    setChooserUri(null);
    restoreLyricsPanelFocus();
  }, [restoreLyricsPanelFocus]);

  const openSyncLyrics = useCallback(() => {
    setPendingChooserUri(null);
    setChooserUri(null);
    setFinderUri(null);
    setMaker(null);
    setSyncTrackUri(trackUri);
  }, [trackUri]);

  const closeSyncLyrics = useCallback(() => {
    setSyncTrackUri(null);
    requestAnimationFrame(() => {
      if (document.activeElement === document.body) trackActionsRef.current?.focus({ preventScroll: true });
    });
  }, []);

  const addLyricsFile = useCallback(() => {
    importLyricsFile()
      .then((used) => {
        if (used) setChooserUri(null);
      })
      // The host explains a file it can't use in an alert.
      .catch(noop);
  }, []);

  const useAutomaticLyrics = useCallback(() => {
    resetLyricsChoice().catch(noop);
  }, []);

  const allowBrowserLyrics = useCallback(() => setBrowserLyrics('Allow'), []);

  const chooserPresence = useExitPresence(chooserOpen && Boolean(track) && !maker, 130);
  const finderOpen = canFind && finderUri === trackUri;
  const finderPresence = useExitPresence(finderOpen, 130);
  const firstRunPresence = useExitPresence(isMac && !onboarded, 140);
  const modalBlocksBackground = firstRunPresence.mounted && !firstRunPresence.closing;

  const chooser = chooserPresence.mounted && track ? (
    <ChooseLyricsPanel
      closing={chooserPresence.closing}
      trackKey={track.uri}
      trackTitle={track.title}
      trackArtist={track.artist}
      trackDurationMs={durationMs}
      origin={lyricsOrigin}
      onAllowBrowserLyrics={allowBrowserLyrics}
      onClose={closeChooser}
    />
  ) : null;

  const retryLyrics = useCallback(() => {
    refreshedUriForRetry.current = '';
    forceRefreshLyrics().catch(noop);
  }, []);

  const nudgeOffset = useCallback((deltaMs: number) => {
    nudgeLyricOffset(deltaMs)
      .catch(noop);
  }, []);

  const resetOffset = useCallback(() => {
    setLyricOffset(0)
      .catch(noop);
  }, []);

  const setOffset = useCallback((offsetMs: number) => {
    setLyricOffset(offsetMs)
      .catch(noop);
  }, []);

  const syncing = syncTrackUri === trackUri && lyricsStatus === 'Ready';

  return (
    <main ref={windowRef} className="lyra-window">
      <div ref={revealRimRef} className="window-reveal-rim" aria-hidden="true" />
      {drawsWindowControls && <WindowControls />}

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
        lyricsOrigin={lyricsOrigin}
        onAddLyricsFile={addLyricsFile}
        onArtworkError={handleArtworkError}
        onChooseLyrics={openChooserFromTrack}
        onCloseSyncLyrics={closeSyncLyrics}
        makerOpen={!!maker}
        onShareTimed={() => openMaker(true)}
        onFindLyrics={!maker && canFind ? openFinderFromTrack : null}
        onNudgeOffset={nudgeOffset}
        onResetOffset={resetOffset}
        onRetryLyrics={retryLyrics}
        onSetOffset={setOffset}
        onSyncLyrics={openSyncLyrics}
        onUseAutomaticLyrics={useAutomaticLyrics}
        positionLabelRef={positionLabelRef}
        progressFillRef={progressFillRef}
        progressPct={progressPct}
        progressTrackRef={progressTrackRef}
        togglePlaying={togglePlaying}
        onMarkNotMusic={markNotMusic}
        setPositionMs={setPositionMs}
        showDelayControl={syncing}
        skipDirection={skipDirection}
        snapshotReady={snapshotReady}
        track={track}
        trackActionsRef={trackActionsRef}
        lyrics={syncedLyrics}
        onSkip={skip}
        inert={modalBlocksBackground}
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
        canSeek={caps.seek}
        onScrollToLine={scrollToLine}
        inert={modalBlocksBackground}
        wordRefs={wordRefs}
        isBrowsing={isBrowsing}
        onReturnToCurrent={returnToCurrent}
        switching={switching}
        onLineMenu={openLineMenu}
        automationDenied={automationDenied}
        syncRail={syncing && <SyncNudge lyricOffsetMs={lyricOffsetMs} onNudgeOffset={nudgeOffset} />}
        vocalCue={vocalCountdown !== null && <div className="lyrics-vocal-cue"><VocalCountdown seconds={vocalCountdown} /></div>}
        finderActive={finderOpen}
        finder={finderPresence.mounted && (
          <FindLyricsPanel
            closing={finderPresence.closing}
            focusRequest={finderFocus}
            lyrics={syncedLyrics}
            plainLyrics={lyricsStatus === 'Unsynced' ? plainLyrics : null}
            canSeek={caps.seek}
            onSeek={seekFromLine}
            onClose={closeFinder}
          />
        )}
        onOpenAutomationSettings={openPrivacySettings}
        {...(hasTrack ? { onChooseLyrics: openChooser, onAddLyricsFile: addLyricsFile } : {})}
        {...(track && (lyricsViewState === 'empty' || lyricsViewState === 'error' || (lyricsViewState === 'unsynced' && plainLyrics))
          ? { onTimeLyrics: (opener: HTMLButtonElement) => openMaker(false, opener) } : {})}
        {...(maker ? { chooser: (
          <LyricMaker key={maker.track.uri} track={maker.track} trackMatches={trackUri === maker.track.uri}
            plain={maker.plain} alreadySaved={maker.saved} playing={isPlaying} hasPosition={hasPosition}
            baseline={baselineRef} timingClock={timingClock} onDirtyChange={setMakerDirty}
            onClose={() => { setMakerDirty(false); setMaker(null); restoreLyricsPanelFocus(); }} />
        ) } : chooser ? { chooser } : {})}
      />

      <ShortcutHud hud={hud} />
      {firstRunPresence.mounted && (
        <FirstRunCard closing={firstRunPresence.closing} onContinue={finishOnboarding} />
      )}
    </main>
  );
}

export default App;
