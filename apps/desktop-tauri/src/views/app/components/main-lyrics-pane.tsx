import { memo, useCallback, useEffect, useMemo, useState, type ReactNode, type RefObject } from 'react';
import { LyricsPlaceholder } from '@/components/lyrics-placeholder';
import type { BrowserLyrics, IgnoredMedia, LyricWord } from '@/types/tauri-contracts';
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
  onBrowserLyrics,
  ignoredMedia,
  onFollowIgnored,
  onFollowAutomatically,
  paintRange,
  screenEdgeMotion,
  seekToLine,
  wordRefs,
  isBrowsing,
  onReturnToCurrent,
  switching,
  onLineMenu,
  automationDenied,
  onOpenAutomationSettings,
  onChooseLyrics,
  onAddLyricsFile,
  onTimeLyrics,
  onScrollToLine,
  canSeek = true,
  inert = false,
  chooser,
  finder,
  finderActive,
  vocalCue,
  syncRail,
}: Readonly<{
  onTimeLyrics?: (opener: HTMLButtonElement) => void;
  onScrollToLine?: (index: number) => void;
  canSeek?: boolean;
  inert?: boolean;
  finder: ReactNode;
  finderActive?: boolean;
  vocalCue: ReactNode;
  /** Earlier and Later beside the current line while Adjust sync is open. */
  syncRail?: ReactNode;
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
  onBrowserLyrics: (choice: BrowserLyrics) => void;
  ignoredMedia: IgnoredMedia | null;
  onFollowIgnored: () => void;
  onFollowAutomatically: () => void;
  paintRange: PaintRange | null;
  screenEdgeMotion: ScreenEdgeMotionMap;
  seekToLine: (index: number, ts: number) => void;
  wordRefs: RefObject<(HTMLSpanElement | null)[]>;
  /** The reader scrolled away from the current line. */
  isBrowsing: boolean;
  onReturnToCurrent: () => void;
  /** A skip was requested and the next track hasn't arrived yet. */
  switching: boolean;
  /** Right-click: `index` is the line pressed, or null outside a line. */
  onLineMenu: (index: number | null) => void;
  /** Players macOS refused to let Lyra read; shown when nothing plays. */
  automationDenied?: ReadonlyArray<string>;
  onOpenAutomationSettings?: () => void;
  /** Open the lyrics chooser from the no-lyrics state. */
  onChooseLyrics?: () => void;
  /** Ask for a lyrics file from the no-lyrics state. */
  onAddLyricsFile?: () => void;
  /** The lyrics chooser, shown in place of the lyrics while open. */
  chooser?: React.ReactNode;
}>) {
  const placeholderProps = {
    ...(onRetryLyrics ? { onRetry: onRetryLyrics } : {}),
    ...(onChooseLyrics ? { onChooseLyrics } : {}),
    ...(onAddLyricsFile ? { onAddLyricsFile } : {}),
    ...(onTimeLyrics ? { onTimeLyrics } : {}),
  };
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
    const base = keyboardLineIndex ?? activeLine ?? 0;
    const next = Math.max(0, Math.min(lyrics.length - 1, base + delta));
    setKeyboardLineIndex(next);
    onScrollToLine?.(next);
  }, [activeLine, hasLyrics, keyboardLineIndex, lyrics.length, onScrollToLine]);

  const handleLyricsPaneFocus = useCallback(() => {
    if (hasLyrics && keyboardLineIndex === null) {
      setKeyboardLineIndex(activeLine ?? 0);
    }
  }, [activeLine, hasLyrics, keyboardLineIndex]);

  const handleLyricsPaneBlur = useCallback((event: React.FocusEvent<HTMLElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget)) {
      setKeyboardLineIndex(null);
    }
  }, []);

  const handleLyricsPaneKeyDown = useCallback((event: React.KeyboardEvent<HTMLElement>) => {
    if (chooser || finder || !hasLyrics || selectedLineIndex === null) return;
    if (event.target !== event.currentTarget
      && !(event.target instanceof Element && event.target.closest('button.lyric-line'))) return;

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
      onScrollToLine?.(0);
      return;
    }

    if (event.key === 'End') {
      event.preventDefault();
      const last = lyrics.length - 1;
      setKeyboardLineIndex(last);
      onScrollToLine?.(last);
      return;
    }

    if ((event.key === 'Enter' || event.key === ' ') && canSeek) {
      event.preventDefault();
      seekToLine(selectedLineIndex, event.timeStamp);
    }
  }, [canSeek, chooser, finder, hasLyrics, lyrics.length, moveKeyboardLine, onScrollToLine, seekToLine, selectedLineIndex]);

  const handleContextMenu = useCallback((event: React.MouseEvent<HTMLElement>) => {
    if (chooser) return;
    if (lyricsViewState !== 'ready' && lyricsViewState !== 'unsynced') return;
    event.preventDefault();
    const line = event.target instanceof Element ? event.target.closest('button.lyric-line') : null;
    const index = line ? lyricsRef.current.indexOf(line as HTMLButtonElement) : -1;
    onLineMenu(index >= 0 ? index : null);
  }, [chooser, lyricsRef, lyricsViewState, onLineMenu]);

  const isFinderActive = finderActive ?? Boolean(finder);

  const activeLineId = selectedLineIndex !== null && !chooser && !isFinderActive && lyricsViewState === 'ready'
    ? `lyric-line-${selectedLineIndex}`
    : undefined;

  return (
    <section
      className={`lyrics-pane ${lyricsViewState === 'unsynced' ? 'is-unsynced' : ''} ${lyricsViewState === 'ready' || lyricsViewState === 'unsynced' ? '' : 'is-placeholder'} ${isBrowsing ? 'is-browsing' : ''} ${switching ? 'is-switching' : ''} ${chooser ? 'is-choosing' : ''} ${isFinderActive ? 'is-finding' : ''} ${syncRail && !chooser && !isFinderActive ? 'is-syncing' : ''}`}
      aria-label="Lyrics"
      aria-activedescendant={activeLineId}
      inert={inert || undefined}
      onFocus={handleLyricsPaneFocus}
      onBlur={handleLyricsPaneBlur}
      onKeyDown={handleLyricsPaneKeyDown}
      onContextMenu={handleContextMenu}
      ref={lyricsPaneRef}
      tabIndex={!chooser && !isFinderActive && ((lyricsViewState === 'ready' && hasLyrics) || lyricsViewState === 'unsynced') ? 0 : undefined}
    >
      {chooser ?? (lyricsViewState === 'unsynced' ? (
        <div className="plain-lyrics">
          <div className="plain-lyrics-header">
            <p className="plain-lyrics-label">Plain lyrics</p>
            {onTimeLyrics && (
              <button
                type="button"
                className="sync-text-btn"
                onClick={(event) => onTimeLyrics(event.currentTarget)}
              >
                Sync lyrics…
              </button>
            )}
          </div>
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
                id={`lyric-line-${index}`}
                index={index}
                text={line.text}
                proximityClass={getLyricProximityClass(index, activeLine)}
                screenEdgeMotion={screenEdgeMotion[index] ?? null}
                words={words}
                canSeek={canSeek}
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
          onBrowserLyrics={onBrowserLyrics}
          ignored={ignoredMedia}
          onFollowIgnored={onFollowIgnored}
          onFollowAutomatically={onFollowAutomatically}
          automationDenied={automationDenied ?? []}
          {...(onOpenAutomationSettings ? { onOpenAutomationSettings } : {})}
          {...placeholderProps}
        />
      ))}
      {finder}
      {!chooser && !isFinderActive && vocalCue}
      {!chooser && !isFinderActive && syncRail}
      {isBrowsing && lyricsViewState === 'ready' && !chooser && !isFinderActive && (
        <button type="button" className="lyrics-return" onClick={onReturnToCurrent}>
          Back to current line
        </button>
      )}
    </section>
  );
});
