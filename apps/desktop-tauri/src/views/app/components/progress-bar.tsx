import type { RefObject } from 'react';
import type { TrackRef } from '@/types/tauri-contracts';
import type { PositionBaseline } from '@/utils/playback-sync';
import { playbackSeekMs } from '@/utils/tauri-commands';
import { formatMs, noop } from '../utils';

export function ProgressBar({
  baselineRef,
  clampedPositionMs,
  durationMs,
  handleMouseDown,
  hasTrack,
  positionLabelRef,
  progressFillRef,
  progressPct,
  progressTrackRef,
  setPositionMs,
  track,
}: Readonly<{
  baselineRef: RefObject<PositionBaseline>;
  clampedPositionMs: number;
  durationMs: number;
  handleMouseDown: (event: React.MouseEvent<HTMLDivElement>) => void;
  hasTrack: boolean;
  positionLabelRef: RefObject<HTMLSpanElement | null>;
  progressFillRef: RefObject<HTMLDivElement | null>;
  progressPct: number;
  progressTrackRef: RefObject<HTMLDivElement | null>;
  setPositionMs: React.Dispatch<React.SetStateAction<number>>;
  track: TrackRef | null;
}>) {
  const handleProgressKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!track || track.duration_ms === 0) return;
    let targetMs: number;
    if (event.key === 'ArrowLeft') {
      targetMs = Math.max(0, clampedPositionMs - 5000);
    } else if (event.key === 'ArrowRight') {
      targetMs = Math.min(track.duration_ms, clampedPositionMs + 5000);
    } else {
      return;
    }
    event.preventDefault();
    setPositionMs(targetMs);
    const now = performance.now();
    baselineRef.current = { ms: targetMs, at: now, targetMs: targetMs, targetAt: now, blendDur: 1 };
    playbackSeekMs(targetMs).catch(noop);
  };

  return (
    <div className="progress-bar">
      <span className="time-label" ref={positionLabelRef}>{formatMs(clampedPositionMs)}</span>
      <div
        className={`progress-track ${hasTrack ? '' : 'is-placeholder'}`}
        ref={progressTrackRef}
        onMouseDown={handleMouseDown}
        onKeyDown={handleProgressKeyDown}
        role="slider"
        tabIndex={hasTrack ? 0 : -1}
        aria-label="Playback progress"
        aria-valuemin={0}
        aria-valuemax={durationMs}
        aria-valuenow={clampedPositionMs}
        aria-valuetext={`${formatMs(clampedPositionMs)} of ${formatMs(durationMs)}`}
      >
        <div
          className="progress-fill"
          ref={progressFillRef}
          style={{ transform: `scaleX(${Math.max(0, Math.min(1, progressPct / 100))})` }}
        ></div>
      </div>
      <span className="time-label">{formatMs(durationMs)}</span>
    </div>
  );
}
