import { memo, useEffect, useRef, useState, type RefObject } from 'react';
import type { LyricWord } from '@/types/tauri-contracts';
import type { ScreenEdgeMotion } from '../types';

type LyricLineProps = Readonly<{
  id: string;
  index: number;
  text: string;
  proximityClass: string;
  screenEdgeMotion: ScreenEdgeMotion | null;
  words: readonly LyricWord[] | null;
  canSeek: boolean;
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

const ARM_START_DELAY_MS = 120;
const ARM_COMPLETE_DELAY_MS = 600;
const SEEK_PULSE_MS = 280;

export const LyricLine = memo(function LyricLine({
  id,
  index,
  text,
  proximityClass,
  screenEdgeMotion,
  words,
  canSeek,
  isKeyboardFocused,
  isLastEmpty,
  isPaintCulled,
  onSeek,
  lyricsRef,
  wordRefs,
}: LyricLineProps) {
  const [armState, setArmState] = useState<'idle' | 'arming' | 'armed'>('idle');
  const [isSeeking, setIsSeeking] = useState(false);
  const armStartTimerRef = useRef<number | null>(null);
  const armedTimerRef = useRef<number | null>(null);
  const seekTimerRef = useRef<number | null>(null);

  const clearArmTimers = () => {
    if (armStartTimerRef.current !== null) {
      globalThis.clearTimeout(armStartTimerRef.current);
      armStartTimerRef.current = null;
    }
    if (armedTimerRef.current !== null) {
      globalThis.clearTimeout(armedTimerRef.current);
      armedTimerRef.current = null;
    }
  };

  const triggerSeek = (eventTimeStamp: number) => {
    if (!canSeek) return;
    if (seekTimerRef.current !== null) globalThis.clearTimeout(seekTimerRef.current);
    setIsSeeking(true);
    seekTimerRef.current = globalThis.setTimeout(() => {
      seekTimerRef.current = null;
      setIsSeeking(false);
    }, SEEK_PULSE_MS);
    onSeek(index, eventTimeStamp);
  };

  const handleMouseEnter = () => {
    clearArmTimers();
    if (!canSeek) {
      setArmState('idle');
      return;
    }
    armStartTimerRef.current = globalThis.setTimeout(() => {
      armStartTimerRef.current = null;
      setArmState('arming');
    }, ARM_START_DELAY_MS);
    armedTimerRef.current = globalThis.setTimeout(() => {
      armedTimerRef.current = null;
      setArmState('armed');
    }, ARM_COMPLETE_DELAY_MS);
  };

  const handleMouseLeave = () => {
    clearArmTimers();
    setArmState('idle');
  };

  useEffect(() => {
    return () => {
      clearArmTimers();
      if (seekTimerRef.current !== null) globalThis.clearTimeout(seekTimerRef.current);
    };
  }, []);

  const effectiveArmState = canSeek ? armState : 'idle';
  const isArmed = effectiveArmState === 'armed';

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (canSeek && isArmed) {
      triggerSeek(event.timeStamp);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!canSeek) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      triggerSeek(event.timeStamp);
    }
  };

  const className = [
    'lyric-line',
    proximityClass,
    screenEdgeMotion,
    effectiveArmState === 'arming' ? 'is-arming' : '',
    isArmed ? 'is-armed' : '',
    isSeeking ? 'is-seeking' : '',
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
      id={id}
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
      title={canSeek ? (isArmed ? 'Click to seek here' : 'Hover to arm seek') : undefined}
      type="button"
    >
      {canSeek && (
        <span className="seek-indicator" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <circle className="seek-ring-track" cx="12" cy="12" r="9.5" />
            <circle className="seek-ring-progress" cx="12" cy="12" r="9.5" />
            <path className="seek-play" d="M10 8.5v7l6-3.5z" fill="currentColor" />
          </svg>
        </span>
      )}
      {lineContent}
    </button>
  );
});
