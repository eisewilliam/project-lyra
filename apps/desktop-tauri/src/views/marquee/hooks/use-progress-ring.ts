import { useEffect } from 'react';
import { interpolatePosition, type PositionBaseline } from '@/utils/playback-sync';

export function useProgressRing({
  isPlaying,
  durationMs,
  pageVisible,
  surfaceVisible,
  progressTargetRef,
  baselineRef,
}: {
  isPlaying: boolean;
  durationMs: number;
  pageVisible: boolean;
  surfaceVisible: boolean;
  /** Element whose `--track-progress` the cover ring inherits. */
  progressTargetRef: React.RefObject<HTMLElement | null>;
  baselineRef: React.RefObject<PositionBaseline>;
}) {
  useEffect(() => {
    const ring = progressTargetRef.current;
    if (!ring || durationMs <= 0) return;

    // The ring is ~130 px long, so 0.1% steps stay sub-pixel. Stepping on a
    // timer sized to that resolution (100–250 ms) instead of every display
    // frame keeps the stroke repaint off the per-frame path.
    let last = '';
    const write = () => {
      if (!baselineRef.current) return;
      const pos = interpolatePosition(baselineRef.current, performance.now(), isPlaying);
      const pct = Math.max(0, Math.min(1, pos / durationMs)).toFixed(3);
      if (pct === last) return;
      last = pct;
      ring.style.setProperty('--track-progress', pct);
    };

    write();
    if (!isPlaying || !pageVisible || !surfaceVisible) return;

    const stepMs = Math.min(250, Math.max(100, durationMs / 1000));
    const timer = globalThis.setInterval(write, stepMs);
    return () => globalThis.clearInterval(timer);
  }, [isPlaying, durationMs, pageVisible, surfaceVisible, progressTargetRef, baselineRef]);
}
