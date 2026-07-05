import { useEffect, type RefObject } from 'react';
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
}) {
  useEffect(() => {
    if (!pageVisible || !surfaceVisible) return;
    if (!isPlaying && activeLineWords.length === 0) {
      return;
    }
    let raf = 0;
    let lastProgWidth = '';
    let lastTimeLabel = '';
    const lastWordCls: string[] = new Array(activeLineWords.length).fill('');
    const lastWordProgQ: number[] = new Array(activeLineWords.length).fill(-1);

    const updateProgressBar = (pos: number) => {
      const fill = progressFillRef.current;
      const label = positionLabelRef.current;
      if (isPlaying && durationMs > 0 && fill) {
        const pct = Math.min(100, Math.max(0, (Math.min(pos, durationMs) / durationMs) * 100)).toFixed(2);
        const nextWidth = `${pct}%`;
        if (nextWidth !== lastProgWidth) {
          lastProgWidth = nextWidth;
          fill.style.width = nextWidth;
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
      if (isPlaying) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
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
  ]);
}
