import { useEffect } from 'react';
import { interpolatePosition, type PositionBaseline } from '@/utils/playback-sync';
import type { LyricWord } from '@/types/tauri-contracts';

const VISUALIZER_BARS = 8;

function hashString(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.codePointAt(i) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

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
  _lineProgress: number,
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
  activeLineProgress,
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
  activeLineProgress: number;
  activeLineWords: LyricWord[];
  visualizerRefs: React.RefObject<(HTMLSpanElement | null)[]>;
  baselineRef: React.RefObject<PositionBaseline>;
}) {
  useEffect(() => {
    const bars = visualizerRefs.current;
    if (!bars) return;
    const setResting = () => {
      for (const bar of bars) {
        if (!bar) continue;
        bar.style.setProperty('--meter-height', '3px');
        bar.style.setProperty('--meter-opacity', '0.36');
      }
    };

    if (!isPlaying || !pageVisible || !surfaceVisible) {
      setResting();
      return;
    }

    const seed = hashString(trackKey || `${trackTitle}|${trackArtist}`);
    let rafId = 0;
    const tick = () => {
      if (!baselineRef.current) return;
      const pos = interpolatePosition(baselineRef.current, performance.now(), true);
      for (let i = 0; i < VISUALIZER_BARS; i++) {
        const level = musicAwareLevel(i, pos, seed, activeLineProgress, activeLineWords);
        const height = 3 + Math.pow(level, 1.1) * 15;
        const opacity = 0.35 + level * 0.65;
        const bar = bars[i];
        if (!bar) continue;
        bar.style.setProperty('--meter-height', `${height}px`);
        bar.style.setProperty('--meter-opacity', opacity.toFixed(3));
      }
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [
    activeLineProgress,
    activeLineWords,
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
