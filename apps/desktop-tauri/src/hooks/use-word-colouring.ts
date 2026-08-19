import { useEffect, type RefObject } from 'react';
import type { LyricWord } from '@/types/tauri-contracts';
import { runWordColouring, type PositionBaseline } from '@/utils/playback-sync';

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
  useEffect(() => {
    if (words.length === 0 || !pageVisible || !surfaceVisible) return;
    return runWordColouring(words, wordRefs, baselineRef, isPlaying);
  }, [baselineRef, isPlaying, pageVisible, surfaceVisible, wordRefs, words]);
}
