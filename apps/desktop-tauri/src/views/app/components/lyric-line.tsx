import { memo, useEffect, useRef, useState, type RefObject } from 'react';
import type { LyricWord } from '@/types/tauri-contracts';

type LyricLineProps = Readonly<{
  index: number;
  text: string;
  proximityClass: string;
  words: readonly LyricWord[] | null;
  isLastEmpty: boolean;
  onSeek: (index: number, ts: number) => void;
  lyricsRef: RefObject<(HTMLButtonElement | null)[]>;
  wordRefs: RefObject<(HTMLSpanElement | null)[]>;
}>;

export const LyricLine = memo(function LyricLine({
  index,
  text,
  proximityClass,
  words,
  isLastEmpty,
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

  const className = `lyric-line ${proximityClass} ${isArmed ? 'is-armed' : ''}`;

  const defaultText = text || (isLastEmpty ? '' : '♪');
  const lineContent = words ? (
    words.map((w, wi) => (
      <span
        key={`${w.start_ms}-${w.text}`}
        ref={(el) => {
          if (wordRefs.current) {
            wordRefs.current[wi] = el;
          }
        }}
        className="lyric-word upcoming"
      >{w.text}</span>
    ))
  ) : defaultText;

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
      tabIndex={0}
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
