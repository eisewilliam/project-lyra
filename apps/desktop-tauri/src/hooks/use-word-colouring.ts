import { useLayoutEffect, useRef, type RefObject } from 'react';
import type { LyricWord } from '@/types/tauri-contracts';
import { createWordAnimations, runWordColouring, type PositionBaseline, type WordAnimations } from '@/utils/playback-sync';

export function useWordColouring({
  words,
  wordRefs,
  baselineRef,
  isPlaying,
  pageVisible,
  surfaceVisible,
}: {
  words: LyricWord[];
  wordRefs: RefObject<(HTMLSpanElement | null)[]>;
  baselineRef: RefObject<PositionBaseline>;
  isPlaying: boolean;
  pageVisible: boolean;
  surfaceVisible: boolean;
}) {
  const animationsRef = useRef<WordAnimations | null>(null);
  useLayoutEffect(() => {
    if (words.length === 0 || !pageVisible || !surfaceVisible) return;
    const animations = createWordAnimations(words, wordRefs, baselineRef);
    if (animations) {
      animationsRef.current = animations;
      return () => {
        animations.stop();
        animationsRef.current = null;
      };
    }
  }, [baselineRef, pageVisible, surfaceVisible, wordRefs, words]);

  useLayoutEffect(() => {
    if (animationsRef.current || words.length === 0 || !pageVisible || !surfaceVisible) return;
    return runWordColouring(words, wordRefs, baselineRef, isPlaying);
  }, [baselineRef, isPlaying, pageVisible, surfaceVisible, wordRefs, words]);

  // Playback baselines are refs updated by snapshots. Reconcile after each
  // render without rebuilding the animations for every position update.
  useLayoutEffect(() => {
    animationsRef.current?.sync(isPlaying);
  });
}
