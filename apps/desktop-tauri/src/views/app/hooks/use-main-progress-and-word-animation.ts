import { useLayoutEffect, type RefObject } from 'react';
import type { LyricWord } from '@/types/tauri-contracts';
import { useWordColouring } from '@/hooks/use-word-colouring';
import {
  interpolatePosition,
  type PositionBaseline,
} from '@/utils/playback-sync';

export function useMainProgressAndWordAnimation({
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
}: {
  activeLineWords: LyricWord[];
  baselineRef: RefObject<PositionBaseline>;
  durationMs: number;
  isPlaying: boolean;
  pageVisible: boolean;
  positionLabelRef: RefObject<HTMLSpanElement | null>;
  progressFillRef: RefObject<HTMLDivElement | null>;
  surfaceVisible: boolean;
  wordRefs: RefObject<(HTMLSpanElement | null)[]>;
  isDragging: RefObject<boolean>;
}) {
  useWordColouring({
    words: activeLineWords, wordRefs, baselineRef, isPlaying, pageVisible, surfaceVisible,
  });

  useLayoutEffect(() => {
    if (!pageVisible || !surfaceVisible) return;
    if (!isPlaying) return;
    // Word wipes have their own shared animation path. The progress bar and
    // clock step on a timer sized to ~0.1% of the track.
    const progressStepMs = Math.min(250, Math.max(100, durationMs / 1000));
    let timer = 0;
    let lastProgressTransform = progressFillRef.current?.style.transform ?? '';
    let lastTimeLabel = positionLabelRef.current?.textContent ?? '';

    const updateProgressBar = (pos: number) => {
      if (isDragging.current) return;
      const fill = progressFillRef.current;
      const label = positionLabelRef.current;
      if (isPlaying && durationMs > 0 && fill) {
        // 0.1% steps: sub-pixel on any realistic bar width, and an unchanged
        // value skips the style write (and the compositor commit) entirely.
        const scale = Math.min(1, Math.max(0, Math.min(pos, durationMs) / durationMs)).toFixed(3);
        const nextTransform = `scaleX(${scale})`;
        if (nextTransform !== lastProgressTransform) {
          lastProgressTransform = nextTransform;
          fill.style.transform = nextTransform;
        }
      }
      if (isPlaying && label) {
        const totalSec = Math.floor(pos / 1000);
        const m = Math.floor(totalSec / 60);
        const s = totalSec % 60;
        const nextTime = `${m}:${s.toString().padStart(2, '0')}`;
        if (nextTime !== lastTimeLabel) {
          lastTimeLabel = nextTime;
          label.textContent = nextTime;
        }
      }
    };

    const tick = () => {
      const pos = interpolatePosition(baselineRef.current, performance.now(), isPlaying);
      updateProgressBar(pos);
      timer = globalThis.setTimeout(tick, progressStepMs);
    };
    tick();
    return () => {
      globalThis.clearTimeout(timer);
    };
  }, [
    baselineRef,
    durationMs,
    isPlaying,
    pageVisible,
    positionLabelRef,
    progressFillRef,
    surfaceVisible,
    isDragging,
  ]);
}
