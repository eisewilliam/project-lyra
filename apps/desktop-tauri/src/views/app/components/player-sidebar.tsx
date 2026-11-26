import { memo, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { useCrossfadeSrc } from '@/hooks/use-crossfade-src';
import type { LyricsOrigin, PlaybackCaps, TrackRef } from '@/types/tauri-contracts';
import { interpolatePosition, type PositionBaseline } from '@/utils/playback-sync';
import { SyncLyricsPanel } from './sync-lyrics-panel';
import { ProgressBar } from './progress-bar';
import { SourceBadge } from './source-badge';
import { TrackInfo } from './track-info';
import { TransportControls } from './transport-controls';
import type { SkipDirection } from '../hooks/use-track-skip';
import { pickTapTarget } from '../sync-timing';
import type { LineRef } from '../types';

export const PlayerSidebar = memo(function PlayerSidebar({

  artworkError,
  artworkSrc,
  caps,
  clampedPositionMs,
  durationMs,
  handleMouseDown,
  hasArtwork,
  hasTrack,
  hasSyncedLyrics,
  isPlaying,
  lyricOffsetMs,
  lyricsOrigin,
  onAddLyricsFile,
  onArtworkError,
  onChooseLyrics,
  onCloseSyncLyrics,
  onFindLyrics,
  onShareTimed,
  makerOpen,
  onMarkNotMusic,
  onNudgeOffset,
  onResetOffset,
  onRetryLyrics,
  onSetOffset,
  onSyncLyrics,
  onUseAutomaticLyrics,
  positionLabelRef,
  progressFillRef,
  progressPct,
  progressTrackRef,
  setPositionMs,
  showDelayControl,
  skipDirection = 1,
  snapshotReady,
  baselineRef,
  togglePlaying,
  track,
  trackActionsRef,
  lyrics,
  onSkip,
  inert = false,
}: Readonly<{
  artworkError: boolean;
  artworkSrc: string;
  caps: PlaybackCaps;
  clampedPositionMs: number;
  durationMs: number;
  handleMouseDown: (event: React.MouseEvent<HTMLDivElement>) => void;
  hasArtwork: boolean;
  hasTrack: boolean;
  hasSyncedLyrics: boolean;
  isPlaying: boolean;
  lyricOffsetMs: number;
  lyricsOrigin: LyricsOrigin;
  onAddLyricsFile: () => void;
  onArtworkError: () => void;
  onChooseLyrics: () => void;
  onCloseSyncLyrics: () => void;
  makerOpen: boolean;
  onShareTimed: () => void;
  onFindLyrics: (() => void) | null;
  onMarkNotMusic: () => void;
  onNudgeOffset: (deltaMs: number) => void;
  onResetOffset: () => void;
  onRetryLyrics: () => void;
  onSetOffset: (offsetMs: number) => void;
  onSyncLyrics: () => void;
  onUseAutomaticLyrics: () => void;
  positionLabelRef: RefObject<HTMLSpanElement | null>;
  progressFillRef: RefObject<HTMLDivElement | null>;
  progressPct: number;
  progressTrackRef: RefObject<HTMLDivElement | null>;
  setPositionMs: React.Dispatch<React.SetStateAction<number>>;
  showDelayControl: boolean;
  skipDirection?: SkipDirection;
  snapshotReady: boolean;
  baselineRef: RefObject<PositionBaseline>;
  togglePlaying: () => void;
  track: TrackRef | null;
  trackActionsRef: RefObject<HTMLButtonElement | null>;
  /** Lyric lines for the progress bar's scrub preview. */
  lyrics: LineRef[];
  onSkip: (direction: SkipDirection) => void;
  inert?: boolean;
}>) {
  // Track changes crossfade the cover once the new one has decoded.
  const art = useCrossfadeSrc(artworkSrc);
  const [initialSyncTarget, setInitialSyncTarget] = useState<number | null>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const syncLayout = useRef<Array<{ element: HTMLElement; bounds: DOMRect }> | null>(null);

  const captureSyncLayout = () => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const elements = sidebarRef.current?.querySelectorAll<HTMLElement>('.album-art-frame, .progress-bar, .transport-controls');
    if (elements) syncLayout.current = Array.from(elements, (element) => ({ element, bounds: element.getBoundingClientRect() }));
  };

  useLayoutEffect(() => {
    const previous = syncLayout.current;
    syncLayout.current = null;
    if (!previous || document.documentElement.dataset.surfaceVisible === 'false') return;

    const positions = previous.map(({ element, bounds: from }) => ({ element, from, to: element.getBoundingClientRect() }));
    const animations = positions.flatMap(({ element, from, to }) => {
      if (!to.width || !to.height) return [];
      const x = from.x + (from.width - to.width) / 2 - to.x;
      const y = from.y + (from.height - to.height) / 2 - to.y;
      const width = from.width / to.width;
      const height = from.height / to.height;
      if (Math.abs(x) + Math.abs(y) < 0.5 && Math.abs(width - 1) + Math.abs(height - 1) < 0.01) return [];

      return element.animate([
        { translate: `${x}px ${y}px`, scale: `${width} ${height}` },
        { translate: '0px 0px', scale: '1' },
      ], { duration: showDelayControl ? 220 : 175, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
    });
    return () => animations.forEach((animation) => animation.cancel());
  }, [showDelayControl]);

  return (
    <section ref={sidebarRef} className="player-sidebar" inert={inert || undefined}>
      <div className="drag-region" data-tauri-drag-region />

      <div className="album-art-large">
        <div className={`album-art-frame ${hasTrack && !isPlaying ? 'is-paused' : ''}`}>
          {art.previous && (
            <img
              src={art.previous}
              alt=""
              className="album-cover album-cover-previous"
              draggable={false}
              decoding="async"
            />
          )}
          <img
            key={art.id}
            src={art.current}
            alt={hasTrack && !artworkError ? 'Album cover' : ''}
            className={`album-cover ${hasArtwork ? '' : 'placeholder'} ${art.previous ? 'is-entering' : ''}`}
            draggable={false}
            decoding="async"
            onError={onArtworkError}
            onAnimationEnd={art.onEntered}
          />
          {track ? <SourceBadge track={track} canRaise={caps.raise} /> : null}
        </div>
      </div>

      <div className="player-controls-bottom">
        {showDelayControl ? (
          <div className="sync-control-entry w-full">
            <SyncLyricsPanel
              baselineRef={baselineRef}
              initialTarget={initialSyncTarget}
              isPlaying={isPlaying}
              lines={lyrics}
              lyricOffsetMs={lyricOffsetMs}
              onClose={() => {
                captureSyncLayout();
                onCloseSyncLyrics();
              }}
              onNudgeOffset={onNudgeOffset}
              onResetOffset={onResetOffset}
              onSetOffset={onSetOffset}
            />
          </div>
        ) : (
          <TrackInfo
            hasTrack={hasTrack}
            hasSyncedLyrics={hasSyncedLyrics}
            lyricOffsetMs={lyricOffsetMs}
            lyricsOrigin={lyricsOrigin}
            onAddLyricsFile={onAddLyricsFile}
            onChooseLyrics={onChooseLyrics}
            makerOpen={makerOpen}
            onShareTimed={onShareTimed}
            onFindLyrics={onFindLyrics}
            onMarkNotMusic={onMarkNotMusic}
            onRetryLyrics={onRetryLyrics}
            onSyncLyrics={() => {
              captureSyncLayout();
              const position = interpolatePosition(baselineRef.current, performance.now(), isPlaying);
              setInitialSyncTarget(pickTapTarget(lyrics, position, lyricOffsetMs, { after: -1 }));
              onSyncLyrics();
            }}
            onUseAutomaticLyrics={onUseAutomaticLyrics}
            skipDirection={skipDirection}
            snapshotReady={snapshotReady}
            track={track}
            trackActionsRef={trackActionsRef}
          />
        )}

        <ProgressBar
          baselineRef={baselineRef}
          canSeek={caps.seek}
          clampedPositionMs={clampedPositionMs}
          durationMs={durationMs}
          handleMouseDown={handleMouseDown}
          hasTrack={hasTrack}
          lyrics={lyrics}
          lyricOffsetMs={lyricOffsetMs}
          positionLabelRef={positionLabelRef}
          progressFillRef={progressFillRef}
          progressPct={progressPct}
          progressTrackRef={progressTrackRef}
          setPositionMs={setPositionMs}
          track={track}
        />

        <TransportControls
          caps={caps}
          isPlaying={isPlaying}
          togglePlaying={togglePlaying}
          onSkip={onSkip}
        />
      </div>
    </section>
  );
});
