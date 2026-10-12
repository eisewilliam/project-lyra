import { useEffect, useRef } from 'react';
import { interpolatePosition, type PositionBaseline } from '@/utils/playback-sync';
import type { LyricWord } from '@/types/tauri-contracts';

function hashString(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.codePointAt(i) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Bar height at full level, in px (`.audio-bars .bar` in island.css). */
const METER_MAX_PX = 18;
const METER_REST_PX = 3;
/** Bars are drawn at full height and scaled down to their level. */
export const METER_REST_SCALE = METER_REST_PX / METER_MAX_PX;

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function wordAccent(posMs: number, words: LyricWord[]) {
  let accent = 0;
  for (const word of words) {
    const attack = Math.abs(posMs - word.start_ms);
    const sustain = posMs >= word.start_ms && posMs <= word.end_ms ? 0.35 : 0;
    accent = Math.max(accent, clamp01(1 - attack / 180), sustain);
  }
  return accent;
}

export function musicAwareLevel(
  barIndex: number,
  posMs: number,
  seed: number,
  words: LyricWord[],
) {
  const baseFreq = 0.005 + (seed % 4) * 0.0008;
  const slowSwell = Math.sin(posMs * (baseFreq * 0.5) + barIndex * 0.8 + seed * 0.05);
  const midDancer = Math.sin(posMs * baseFreq - barIndex * 1.4 + seed * 0.15);
  const fastFlutter = Math.sin(posMs * (baseFreq * 2.4) + barIndex * 2.2);
  const organicWave = (slowSwell * 0.35 + midDancer * 0.45 + fastFlutter * 0.2 + 1) / 2;
  const lyricAccent = wordAccent(posMs, words);
  const lyricBoost = lyricAccent * 0.35;
  const level = organicWave * (0.65 + lyricBoost) + lyricBoost;
  return clamp01(0.1 + level * 0.9);
}

export function useAudioVisualizer({
  isPlaying,
  pageVisible,
  surfaceVisible,
  trackKey,
  trackTitle,
  trackArtist,
  activeLineWords,
  visualizerRefs,
  baselineRef,
}: {
  isPlaying: boolean;
  pageVisible: boolean;
  surfaceVisible: boolean;
  trackKey: string;
  trackTitle: string;
  trackArtist: string;
  activeLineWords: LyricWord[];
  visualizerRefs: React.RefObject<(HTMLSpanElement | null)[]>;
  baselineRef: React.RefObject<PositionBaseline>;
}) {
  // Read the active words through a ref so a new line doesn't tear down and
  // restart the animation loop (which used to happen on every playback tick).
  const wordsRef = useRef(activeLineWords);
  useEffect(() => {
    wordsRef.current = activeLineWords;
  }, [activeLineWords]);

  useEffect(() => {
    const bars = visualizerRefs.current;
    if (!bars) return;
    const setResting = () => {
      for (const bar of bars) {
        if (!bar) continue;
        bar.style.setProperty('--meter-scale', String(METER_REST_SCALE));
        bar.style.setProperty('--meter-opacity', '0.36');
      }
    };

    if (!isPlaying || !pageVisible || !surfaceVisible) {
      setResting();
      return;
    }

    const seed = hashString(trackKey || `${trackTitle}|${trackArtist}`);
    let rafId = 0;
    const lastHeight: number[] = [];
    const lastOpacity: number[] = [];
    const tick = () => {
      if (!baselineRef.current) return;
      const pos = interpolatePosition(baselineRef.current, performance.now(), true);
      const words = wordsRef.current;
      for (let i = 0; i < bars.length; i++) {
        const bar = bars[i];
        if (!bar) continue;
        const level = musicAwareLevel(i, pos, seed, words);
        // Quantize to half-pixel / 1% steps so frames with no visible change
        // skip the style write and the repaint behind it.
        const height = Math.round((METER_REST_PX + Math.pow(level, 1.1) * (METER_MAX_PX - METER_REST_PX)) * 2) / 2;
        const opacity = Math.round((0.35 + level * 0.65) * 100) / 100;
        if (height !== lastHeight[i]) {
          lastHeight[i] = height;
          bar.style.setProperty('--meter-scale', String(height / METER_MAX_PX));
        }
        if (opacity !== lastOpacity[i]) {
          lastOpacity[i] = opacity;
          bar.style.setProperty('--meter-opacity', String(opacity));
        }
      }
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [
    isPlaying,
    pageVisible,
    surfaceVisible,
    trackArtist,
    trackKey,
    trackTitle,
    visualizerRefs,
    baselineRef,
  ]);
}
