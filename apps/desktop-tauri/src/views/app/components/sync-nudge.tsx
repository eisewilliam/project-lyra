import { useEffect, useRef } from 'react';
import { describeOffset, formatOffsetNumber, NUDGE_STEP_MS } from '../sync-timing';

const HOLD_DELAY_MS = 380;
const HOLD_REPEAT_MS = 70;

/** Press once to step; hold to keep stepping. Keyboard presses step once
 * per click, and key repeat does the rest. */
function useHoldRepeat(step: () => void) {
  const stepRef = useRef(step);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    stepRef.current = step;
  });
  const stop = () => {
    clearTimeout(timer.current);
    timer.current = undefined;
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  return {
    onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) return;
      // Keeps the release here if the pointer drifts off while held.
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Not an active pointer; release still ends the hold.
      }
      stop();
      stepRef.current();
      const repeat = () => {
        stepRef.current();
        timer.current = setTimeout(repeat, HOLD_REPEAT_MS);
      };
      timer.current = setTimeout(repeat, HOLD_DELAY_MS);
    },
    onPointerUp: stop,
    onPointerCancel: stop,
    onLostPointerCapture: stop,
    onClick: (event: React.MouseEvent<HTMLButtonElement>) => {
      if (event.detail === 0) stepRef.current();
    },
  };
}

/** Earlier and Later beside the current lyric line while Adjust sync is
 * open, with the offset between them. */
export function SyncNudge({
  lyricOffsetMs,
  onNudgeOffset,
}: Readonly<{
  lyricOffsetMs: number;
  onNudgeOffset: (deltaMs: number) => void;
}>) {
  const valueRef = useRef<HTMLSpanElement>(null);
  const prevOffsetRef = useRef(lyricOffsetMs);

  useEffect(() => {
    const prev = prevOffsetRef.current;
    prevOffsetRef.current = lyricOffsetMs;
    if (prev === lyricOffsetMs) return;
    if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const el = valueRef.current;
    if (!el) return;
    const keyframes = lyricOffsetMs === 0
      ? [{ transform: 'scale(1.08)' }, { transform: 'scale(1)' }]
      : [
          { transform: `translateY(${lyricOffsetMs > prev ? 5 : -5}px)`, opacity: 0.72 },
          { transform: 'translateY(0px)', opacity: 1 },
        ];
    el.getAnimations().forEach((a) => a.cancel());
    el.animate(keyframes, { duration: 165, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
  }, [lyricOffsetMs]);

  const earlier = useHoldRepeat(() => onNudgeOffset(-NUDGE_STEP_MS));
  const later = useHoldRepeat(() => onNudgeOffset(NUDGE_STEP_MS));
  const description = describeOffset(lyricOffsetMs);

  return (
    <div className="sync-nudge" role="group" aria-label="Lyric sync">
      <button
        type="button"
        className="sync-nudge-btn"
        aria-label="Earlier"
        title="Show lyrics 0.1 s earlier. Hold to keep going. Shortcut: ["
        {...earlier}
      >
        <IconChevron path="M5 12l5-5 5 5" />
      </button>
      <span ref={valueRef} className="sync-nudge-value" title={description} aria-live="polite">
        <span className="sync-nudge-number" aria-hidden="true">{formatOffsetNumber(lyricOffsetMs)}</span>
        <span className="sync-nudge-unit" aria-hidden="true">s</span>
        <span className="sr-only">{description}</span>
      </span>
      <button
        type="button"
        className="sync-nudge-btn"
        aria-label="Later"
        title="Show lyrics 0.1 s later. Hold to keep going. Shortcut: ]"
        {...later}
      >
        <IconChevron path="M5 8l5 5 5-5" />
      </button>
    </div>
  );
}

function IconChevron({ path }: Readonly<{ path: string }>) {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}
