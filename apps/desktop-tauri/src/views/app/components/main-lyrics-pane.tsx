import { memo, useCallback, useEffect, useMemo, useState, type RefObject } from 'react';
import { LyricsPlaceholder } from '@/components/lyrics-placeholder';
import type { LyricWord } from '@/types/tauri-contracts';
import type { LyricsPlaceholderState, NotFoundReason } from '@/utils/lyrics-state';
import type { LineRef, PaintRange, ScreenEdgeMotionMap } from '../types';
import { getLyricProximityClass } from '../utils';
import { LyricLine } from './lyric-line';

export const MainLyricsPane = memo(function MainLyricsPane({

  activeLine,
  activeLineWords,
  karaokeMode,
  lyrics,
  plainLyrics,
  lyricsContainerRef,
  lyricsPaneRef,
  lyricsRef,
  lyricsViewState,
  notFoundReason,
  onRetryLyrics,
  paintRange,
  screenEdgeMotion,
  seekToLine,
  wordRefs,
}: Readonly<{
  activeLine: number | null;
  activeLineWords: ReadonlyArray<LyricWord>;
  karaokeMode: boolean;
  lyrics: ReadonlyArray<LineRef>;
  plainLyrics: string | null;
  lyricsContainerRef: RefObject<HTMLDivElement | null>;
  lyricsPaneRef: RefObject<HTMLElement | null>;
  lyricsRef: RefObject<(HTMLButtonElement | null)[]>;
  lyricsViewState: LyricsPlaceholderState;
  notFoundReason: NotFoundReason | null;
  onRetryLyrics?: () => void;
  paintRange: PaintRange | null;
  screenEdgeMotion: ScreenEdgeMotionMap;
  seekToLine: (index: number, ts: number) => void;
  wordRefs: RefObject<(HTMLSpanElement | null)[]>;
}>) {
  const placeholderProps = onRetryLyrics ? { onRetry: onRetryLyrics } : {};
  const [keyboardLineIndex, setKeyboardLineIndex] = useState<number | null>(null);
  const hasLyrics = lyrics.length > 0;
  const selectedLineIndex = useMemo(() => {
    if (!hasLyrics) return null;
    const candidate = keyboardLineIndex ?? activeLine ?? 0;
    return Math.max(0, Math.min(lyrics.length - 1, candidate));
  }, [activeLine, hasLyrics, keyboardLineIndex, lyrics.length]);

  useEffect(() => {
    if (!hasLyrics) {
      setKeyboardLineIndex(null);
      return;
    }
    setKeyboardLineIndex((current) => {
      if (current === null || current < lyrics.length) return current;
      return lyrics.length - 1;
    });
  }, [hasLyrics, lyrics.length]);

  const moveKeyboardLine = useCallback((delta: number) => {
    if (!hasLyrics) return;
    setKeyboardLineIndex((current) => {
      const base = current ?? activeLine ?? 0;
      return Math.max(0, Math.min(lyrics.length - 1, base + delta));
    });
  }, [activeLine, hasLyrics, lyrics.length]);

  const handleLyricsPaneFocus = useCallback(() => {
    if (hasLyrics && keyboardLineIndex === null) {
      setKeyboardLineIndex(activeLine ?? 0);
    }
  }, [activeLine, hasLyrics, keyboardLineIndex]);

  const handleLyricsPaneKeyDown = useCallback((event: React.KeyboardEvent<HTMLElement>) => {
    if (!hasLyrics || selectedLineIndex === null) return;

    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      event.preventDefault();
      moveKeyboardLine(1);
      return;
    }

    if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      event.preventDefault();
      moveKeyboardLine(-1);
      return;
    }

    if (event.key === 'Home') {
      event.preventDefault();
      setKeyboardLineIndex(0);
      return;
    }

    if (event.key === 'End') {
      event.preventDefault();
      setKeyboardLineIndex(lyrics.length - 1);
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      seekToLine(selectedLineIndex, event.timeStamp);
    }
  }, [hasLyrics, lyrics.length, moveKeyboardLine, seekToLine, selectedLineIndex]);

  return (
    <section
      className={`lyrics-pane ${lyricsViewState === 'unsynced' ? 'is-unsynced' : ''} ${lyricsViewState === 'ready' || lyricsViewState === 'unsynced' ? '' : 'is-placeholder'}`}
      aria-label="Lyrics"
      onFocus={handleLyricsPaneFocus}
      onKeyDown={handleLyricsPaneKeyDown}
      ref={lyricsPaneRef}
      tabIndex={(lyricsViewState === 'ready' && hasLyrics) || lyricsViewState === 'unsynced' ? 0 : undefined}
    >
      {lyricsViewState === 'unsynced' ? (
        <div className="plain-lyrics">
          <p className="plain-lyrics-label">Unsynchronized lyrics</p>
          <p className="plain-lyrics-text">{plainLyrics ?? 'Loading lyrics text…'}</p>
        </div>
      ) : lyricsViewState === 'ready' ? (
        <div
          className={`lyrics-container ${karaokeMode ? 'is-karaoke' : ''}`}
          ref={lyricsContainerRef}
        >
          {lyrics.map((line, index) => {
            const isActive = index === activeLine;
            const words = isActive && activeLineWords.length > 0 ? activeLineWords : null;
            const isPaintCulled = paintRange !== null
              && selectedLineIndex !== index
              && (index < paintRange.start || index > paintRange.end);

            return (
              <LyricLine
                key={`${line.start_ms}-${line.text}`}
                index={index}
                text={line.text}
                proximityClass={getLyricProximityClass(index, activeLine)}
                screenEdgeMotion={screenEdgeMotion[index] ?? null}
                words={words}
                isKeyboardFocused={selectedLineIndex === index}
                isLastEmpty={index === lyrics.length - 1}
                isPaintCulled={isPaintCulled}
                onSeek={seekToLine}
                lyricsRef={lyricsRef}
                wordRefs={wordRefs}
              />
            );
          })}
        </div>
      ) : (
        <LyricsPlaceholder
          state={lyricsViewState}
          notFoundReason={notFoundReason}
          {...placeholderProps}
        />
      )}
    </section>
  );
});
