import type { RefObject } from 'react';
import { LyricsPlaceholder } from '@/components/lyrics-placeholder';
import type { LyricWord } from '@/types/tauri-contracts';
import type { LyricsPlaceholderState, NotFoundReason } from '@/utils/lyrics-state';
import type { LineRef } from '../types';
import { getLyricProximityClass } from '../utils';
import { LyricLine } from './lyric-line';

export function MainLyricsPane({
  activeLine,
  activeLineWords,
  karaokeMode,
  lyrics,
  lyricsContainerRef,
  lyricsPaneRef,
  lyricsRef,
  lyricsViewState,
  notFoundReason,
  onRetryLyrics,
  seekToLine,
  wordRefs,
}: Readonly<{
  activeLine: number | null;
  activeLineWords: ReadonlyArray<LyricWord>;
  karaokeMode: boolean;
  lyrics: ReadonlyArray<LineRef>;
  lyricsContainerRef: RefObject<HTMLDivElement | null>;
  lyricsPaneRef: RefObject<HTMLElement | null>;
  lyricsRef: RefObject<(HTMLButtonElement | null)[]>;
  lyricsViewState: LyricsPlaceholderState;
  notFoundReason: NotFoundReason | null;
  onRetryLyrics?: () => void;
  seekToLine: (index: number, ts: number) => void;
  wordRefs: RefObject<(HTMLSpanElement | null)[]>;
}>) {
  const placeholderProps = onRetryLyrics ? { onRetry: onRetryLyrics } : {};

  return (
    <section
      className={`lyrics-pane ${lyricsViewState === 'ready' ? '' : 'is-placeholder'}`}
      ref={lyricsPaneRef}
    >
      {lyricsViewState === 'ready' ? (
        <div
          className={`lyrics-container ${karaokeMode ? 'is-karaoke' : ''}`}
          ref={lyricsContainerRef}
        >
          {lyrics.map((line, index) => {
            const isActive = index === activeLine;
            const words = isActive && activeLineWords.length > 0 ? activeLineWords : null;

            return (
              <LyricLine
                key={`${line.start_ms}-${line.text}`}
                index={index}
                text={line.text}
                proximityClass={getLyricProximityClass(index, activeLine)}
                words={words}
                isLastEmpty={index === lyrics.length - 1}
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
}
