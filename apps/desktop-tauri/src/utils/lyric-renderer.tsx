import type { ReactNode, RefObject } from 'react';
import type { LyricWord, LyricsStatus } from '@/types/tauri-contracts';
import { isLyricsError, isLyricsNotFound } from './lyrics-state';

export function shouldShowTrackIntro({
  snapshotReady,
  hasTrack,
  hasActiveLyric,
  trackTitle,
  lyricsStatus,
}: Readonly<{
  snapshotReady: boolean;
  hasTrack: boolean;
  hasActiveLyric: boolean;
  trackTitle: string;
  lyricsStatus: LyricsStatus;
}>): boolean {
  return (
    snapshotReady &&
    hasTrack &&
    !hasActiveLyric &&
    trackTitle.length > 0 &&
    !isLyricsError(lyricsStatus) &&
    !isLyricsNotFound(lyricsStatus)
  );
}

export function getActiveContentKey(words: ReadonlyArray<LyricWord>, activeLine: string | null): string {
  if (words.length > 0) {
    return words.map((word) => `${word.start_ms}:${word.text}`).join('|');
  }
  return activeLine || '';
}

export function getCurrentLineFallback(activeLine: string | null, nextLine: string | null): string {
  if (activeLine) return activeLine;
  if (nextLine === null) return '';
  return '♪';
}

export function getNextLineText(nextLine: string | null): string {
  if (nextLine === '') return '♪';
  return nextLine || '';
}

export function renderLyricContent(
  words: ReadonlyArray<LyricWord>,
  wordRefs: RefObject<(HTMLSpanElement | null)[]>,
  fallback: string,
): ReactNode {
  if (words.length === 0) return fallback;
  return words.map((w, i) => (
    <span
      key={`${w.start_ms}-${w.text}`}
      ref={(el) => {
        if (wordRefs.current) {
          wordRefs.current[i] = el;
        }
      }}
      className="lyric-word upcoming"
    >
      {w.text}
    </span>
  ));
}
