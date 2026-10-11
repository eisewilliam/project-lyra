import { useLayoutEffect, type RefObject } from 'react';
import type { LyricWord } from '@/types/tauri-contracts';
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
  useLayoutEffect(() => {
    if (!pageVisible || !surfaceVisible) return;
    if (!isPlaying && activeLineWords.length === 0) {
      return;
    }
    // Word wipes need every frame. Without them only the progress bar and
    // clock move, so step on a timer sized to ~0.1% of the track (well under
    // a pixel of the bar) instead of waking the page for every display frame.
    const animateWords = activeLineWords.length > 0;
    const progressStepMs = Math.min(250, Math.max(100, durationMs / 1000));
    let raf = 0;
    let timer = 0;
    let lastProgressTransform = progressFillRef.current?.style.transform ?? '';
    let lastTimeLabel = positionLabelRef.current?.textContent ?? '';
    const lastWordCls: string[] = new Array(activeLineWords.length);
    const lastWordProgQ: number[] = new Array(activeLineWords.length);

    for (let i = 0; i < activeLineWords.length; i++) {
      const el = wordRefs.current[i];
      lastWordCls[i] = el?.className || 'lyric-word upcoming';
      const progress = Number(el?.style.getPropertyValue('--word-progress') || '0');
      lastWordProgQ[i] = Number.isFinite(progress) ? Math.trunc(progress * 1000) : 0;
    }

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

    const updateWordColors = (pos: number) => {
      for (let i = 0; i < activeLineWords.length; i++) {
        const w = activeLineWords[i];
        const el = wordRefs.current[i];
        if (!w || !el) continue;
        let cls: string;
        let progress: number;
        if (pos >= w.end_ms) {
          cls = 'lyric-word passed';
          progress = 1;
        } else if (pos >= w.start_ms) {
          cls = 'lyric-word singing';
          progress = Math.max(0, Math.min(1, (pos - w.start_ms) / Math.max(1, w.end_ms - w.start_ms)));
        } else {
          cls = 'lyric-word upcoming';
          progress = 0;
        }
        if (cls !== lastWordCls[i]) {
          lastWordCls[i] = cls;
          el.className = cls;
        }
        const progQ = Math.trunc(progress * 1000);
        if (progQ !== lastWordProgQ[i]) {
          lastWordProgQ[i] = progQ;
          el.style.setProperty('--word-progress', (progQ / 1000).toString());
        }
      }
    };

    const tick = () => {
      const pos = interpolatePosition(baselineRef.current, performance.now(), isPlaying);
      updateProgressBar(pos);
      updateWordColors(pos);
      if (!isPlaying) return;
      if (animateWords) {
        raf = requestAnimationFrame(tick);
      } else {
        timer = globalThis.setTimeout(tick, progressStepMs);
      }
    };
    tick();
    return () => {
      cancelAnimationFrame(raf);
      globalThis.clearTimeout(timer);
    };
  }, [
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
  ]);
}
