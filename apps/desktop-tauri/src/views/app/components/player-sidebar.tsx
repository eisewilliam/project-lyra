import { memo, type RefObject } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import type { TrackRef } from '@/types/tauri-contracts';
import type { PositionBaseline } from '@/utils/playback-sync';
import { DelayControl } from './delay-control';
import { ProgressBar } from './progress-bar';
import { TrackInfo } from './track-info';
import { TransportControls } from './transport-controls';

const INLINE_CONTROL_EASE = [0.22, 1, 0.36, 1] as const;

export const PlayerSidebar = memo(function PlayerSidebar({

  artworkError,
  artworkSrc,
  clampedPositionMs,
  durationMs,
  handleMouseDown,
  hasArtwork,
  hasTrack,
  isPlaying,
  lyricOffsetMs,
  offsetLabel,
  onArtworkError,
  onNudgeOffset,
  onResetOffset,
  onRetryLyrics,
  positionLabelRef,
  progressFillRef,
  progressPct,
  progressTrackRef,
  setIsPlaying,
  setPositionMs,
  setShowDelayControl,
  setSelectValue,
  showDelayControl,
  snapshotReady,
  baselineRef,
  selectValue,
  track,
}: Readonly<{
  artworkError: boolean;
  artworkSrc: string;
  clampedPositionMs: number;
  durationMs: number;
  handleMouseDown: (event: React.MouseEvent<HTMLDivElement>) => void;
  hasArtwork: boolean;
  hasTrack: boolean;
  isPlaying: boolean;
  lyricOffsetMs: number;
  offsetLabel: string;
  onArtworkError: () => void;
  onNudgeOffset: (deltaMs: number) => void;
  onResetOffset: () => void;
  onRetryLyrics: () => void;
  positionLabelRef: RefObject<HTMLSpanElement | null>;
  progressFillRef: RefObject<HTMLDivElement | null>;
  progressPct: number;
  progressTrackRef: RefObject<HTMLDivElement | null>;
  setIsPlaying: React.Dispatch<React.SetStateAction<boolean>>;
  setPositionMs: React.Dispatch<React.SetStateAction<number>>;
  setShowDelayControl: React.Dispatch<React.SetStateAction<boolean>>;
  setSelectValue: React.Dispatch<React.SetStateAction<string>>;
  showDelayControl: boolean;
  snapshotReady: boolean;
  baselineRef: RefObject<PositionBaseline>;
  selectValue: string;
  track: TrackRef | null;
}>) {
  const prefersReducedMotion = useReducedMotion();

  return (
    <section className="player-sidebar">
      <div className="drag-region" data-tauri-drag-region />

      <div className="album-art-large">
        <img
          src={artworkSrc}
          alt={hasTrack && !artworkError ? 'Album cover' : ''}
          className={`album-cover ${hasArtwork ? '' : 'placeholder'}`}
          draggable={false}
          decoding="async"
          onError={onArtworkError}
        />
      </div>

      <div className="player-controls-bottom">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={showDelayControl ? 'delay-control' : 'track-info'}
            className="w-full"
            initial={prefersReducedMotion ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={prefersReducedMotion ? { opacity: 1, y: 0 } : { opacity: 0, y: -4 }}
            transition={prefersReducedMotion ? { duration: 0 } : { duration: 0.18, ease: INLINE_CONTROL_EASE }}
          >
            {showDelayControl ? (
              <DelayControl
                lyricOffsetMs={lyricOffsetMs}
                offsetLabel={offsetLabel}
                onClose={() => setShowDelayControl(false)}
                onNudgeOffset={onNudgeOffset}
                onResetOffset={onResetOffset}
              />
            ) : (
              <TrackInfo
                hasTrack={hasTrack}
                onRetryLyrics={onRetryLyrics}
                selectValue={selectValue}
                setSelectValue={setSelectValue}
                setShowDelayControl={setShowDelayControl}
                snapshotReady={snapshotReady}
                track={track}
              />
            )}
          </motion.div>
        </AnimatePresence>

        <ProgressBar
          baselineRef={baselineRef}
          clampedPositionMs={clampedPositionMs}
          durationMs={durationMs}
          handleMouseDown={handleMouseDown}
          hasTrack={hasTrack}
          positionLabelRef={positionLabelRef}
          progressFillRef={progressFillRef}
          progressPct={progressPct}
          progressTrackRef={progressTrackRef}
          setPositionMs={setPositionMs}
          track={track}
        />

        <TransportControls
          isPlaying={isPlaying}
          setIsPlaying={setIsPlaying}
        />
      </div>
    </section>
  );
});
