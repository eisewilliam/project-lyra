import { memo, type RefObject } from 'react';
import { useCrossfadeSrc } from '@/hooks/use-crossfade-src';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import type { PlaybackCaps, TrackRef } from '@/types/tauri-contracts';
import type { PositionBaseline } from '@/utils/playback-sync';
import { SyncLyricsPanel } from './sync-lyrics-panel';
import { ProgressBar } from './progress-bar';
import { SourceBadge } from './source-badge';
import { TrackInfo } from './track-info';
import { TransportControls } from './transport-controls';
import type { SkipDirection } from '../hooks/use-track-skip';
import type { LineRef } from '../types';

const INLINE_CONTROL_EASE = [0.22, 1, 0.36, 1] as const;

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
  onArtworkError,
  onMarkNotMusic,
  onNudgeOffset,
  onResetOffset,
  onRetryLyrics,
  onSetOffset,
  positionLabelRef,
  progressFillRef,
  progressPct,
  progressTrackRef,
  setPositionMs,
  setShowDelayControl,
  showDelayControl,
  snapshotReady,
  baselineRef,
  togglePlaying,
  track,
  lyrics,
  onSkip,
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
  onArtworkError: () => void;
  onMarkNotMusic: () => void;
  onNudgeOffset: (deltaMs: number) => void;
  onResetOffset: () => void;
  onRetryLyrics: () => void;
  onSetOffset: (offsetMs: number) => void;
  positionLabelRef: RefObject<HTMLSpanElement | null>;
  progressFillRef: RefObject<HTMLDivElement | null>;
  progressPct: number;
  progressTrackRef: RefObject<HTMLDivElement | null>;
  setPositionMs: React.Dispatch<React.SetStateAction<number>>;
  setShowDelayControl: React.Dispatch<React.SetStateAction<boolean>>;
  showDelayControl: boolean;
  snapshotReady: boolean;
  baselineRef: RefObject<PositionBaseline>;
  togglePlaying: () => void;
  track: TrackRef | null;
  /** Lyric lines for the progress bar's scrub preview. */
  lyrics: LineRef[];
  onSkip: (direction: SkipDirection) => void;
}>) {
  const prefersReducedMotion = useReducedMotion();
  // Track changes crossfade the cover once the new one has decoded.
  const art = useCrossfadeSrc(artworkSrc);

  return (
    <section className="player-sidebar">
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
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={showDelayControl ? 'sync-lyrics' : 'track-info'}
            className="w-full"
            initial={prefersReducedMotion ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={prefersReducedMotion ? { opacity: 1, y: 0 } : { opacity: 0, y: -4 }}
            transition={prefersReducedMotion ? { duration: 0 } : { duration: 0.18, ease: INLINE_CONTROL_EASE }}
          >
            {showDelayControl ? (
              <SyncLyricsPanel
                baselineRef={baselineRef}
                isPlaying={isPlaying}
                lines={lyrics}
                lyricOffsetMs={lyricOffsetMs}
                onClose={() => setShowDelayControl(false)}
                onNudgeOffset={onNudgeOffset}
                onResetOffset={onResetOffset}
                onSetOffset={onSetOffset}
              />
            ) : (
              <TrackInfo
                hasTrack={hasTrack}
                hasSyncedLyrics={hasSyncedLyrics}
                lyricOffsetMs={lyricOffsetMs}
                onMarkNotMusic={onMarkNotMusic}
                onRetryLyrics={onRetryLyrics}
                setShowDelayControl={setShowDelayControl}
                snapshotReady={snapshotReady}
                track={track}
              />
            )}
          </motion.div>
        </AnimatePresence>

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
