import { useEffect } from 'react';
import { interpolatePosition, type PositionBaseline } from '@/utils/playback-sync';

export function useProgressRing({
  isPlaying,
  durationMs,
  pageVisible,
  surfaceVisible,
  progressRingRef,
  baselineRef,
}: {
  isPlaying: boolean;
  durationMs: number;
  pageVisible: boolean;
  surfaceVisible: boolean;
  progressRingRef: React.RefObject<SVGSVGElement | null>;
  baselineRef: React.RefObject<PositionBaseline>;
}) {
  useEffect(() => {
    const ring = progressRingRef.current;
    if (!ring) return;
    if (!isPlaying || durationMs <= 0 || !pageVisible || !surfaceVisible) {
      if (baselineRef.current) {
        const pos = interpolatePosition(baselineRef.current, performance.now(), isPlaying);
        const pct = Math.max(0, Math.min(1, pos / durationMs));
        ring.style.setProperty('--track-progress', String(pct));
      }
      return;
    }

    let rafId: number;
    const tick = () => {
      if (!baselineRef.current) return;
      const pos = interpolatePosition(baselineRef.current, performance.now(), isPlaying);
      const pct = Math.max(0, Math.min(1, pos / durationMs));
      ring.style.setProperty('--track-progress', String(pct));
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [isPlaying, durationMs, pageVisible, surfaceVisible, progressRingRef, baselineRef]);
}
