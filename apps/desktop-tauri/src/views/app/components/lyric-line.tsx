import { memo, useEffect, useRef, useState, type RefObject } from 'react';
import type { LyricWord } from '@/types/tauri-contracts';
import type { ScreenEdgeMotion } from '../types';

type LyricLineProps = Readonly<{
  index: number;
  text: string;
  proximityClass: string;
  screenEdgeMotion: ScreenEdgeMotion | null;
  words: readonly LyricWord[] | null;
  isKeyboardFocused: boolean;
  isLastEmpty: boolean;
  isPaintCulled: boolean;
  onSeek: (index: number, ts: number) => void;
  lyricsRef: RefObject<(HTMLButtonElement | null)[]>;
  wordRefs: RefObject<(HTMLSpanElement | null)[]>;
}>;

function splitLyricText(text: string) {
  const tokens: string[] = [];
  let token = '';

  for (const char of text) {
    token += char;
    if (/\s/.test(char)) {
      tokens.push(token);
      token = '';
    }
  }

  if (token) {
    tokens.push(token);
  }

  return tokens;
}

export const LyricLine = memo(function LyricLine({
  index,
  text,
  proximityClass,
  screenEdgeMotion,
  words,
  isKeyboardFocused,
  isLastEmpty,
  isPaintCulled,
  onSeek,
  lyricsRef,
  wordRefs,
}: LyricLineProps) {
  const [isArmed, setIsArmed] = useState(false);
  const timerRef = useRef<number | null>(null);

  const handleMouseEnter = () => {
    if (timerRef.current) globalThis.clearTimeout(timerRef.current);
    timerRef.current = globalThis.setTimeout(() => {
      setIsArmed(true);
    }, 600);
  };

  const handleMouseLeave = () => {
    if (timerRef.current) {
      globalThis.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setIsArmed(false);
  };

  useEffect(() => {
    return () => {
      if (timerRef.current) globalThis.clearTimeout(timerRef.current);
    };
  }, []);

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (isArmed) {
      onSeek(index, event.timeStamp);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSeek(index, event.timeStamp);
    }
  };

  const className = [
    'lyric-line',
    proximityClass,
    screenEdgeMotion,
    isArmed ? 'is-armed' : '',
    isKeyboardFocused ? 'is-keyboard-focus' : '',
    isPaintCulled ? 'is-paint-culled' : '',
  ].filter(Boolean).join(' ');

  const defaultText = text || (isLastEmpty ? '' : '♪');
  const timedWords = words && words.length > 0 ? words : null;
  const lineWords = timedWords ?? splitLyricText(defaultText).map((token) => ({
    start_ms: 0,
    end_ms: 0,
    text: token,
  }));
  const lineContent = (
    lineWords.map((w, wi) => (
      <span
        key={`word-${wi}-${w.text}`}
        ref={timedWords
          ? (el) => {
              if (wordRefs.current) {
                wordRefs.current[wi] = el;
              }
            }
          : undefined}
        className="lyric-word upcoming"
      >{w.text}</span>
    ))
  );

  return (
    <button
      ref={(el) => {
        if (lyricsRef.current) {
          lyricsRef.current[index] = el;
        }
      }}
      className={className}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      tabIndex={-1}
      title={isArmed ? "Click to seek here" : "Hover to arm seek"}
      type="button"
    >
      <span className="seek-indicator" aria-hidden="true">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
          <path d="M8 5v14l11-7z" />
        </svg>
      </span>
      {lineContent}
    </button>
  );
});
