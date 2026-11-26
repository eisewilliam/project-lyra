import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import { interpolatePosition, type PositionBaseline } from '@/utils/playback-sync';
import {
  isTapTargetStale,
  NUDGE_STEP_MS,
  offsetForTap,
  pickTapTarget,
  TAP_STALE_MS,
} from '../sync-timing';
import type { LineRef } from '../types';

/** Line the lyrics up with the singer: tap as a line is sung, or nudge the
 * timing earlier or later. Changes apply live and are saved per song. */
export function SyncLyricsPanel({
  baselineRef,
  initialTarget,
  isPlaying,
  lines,
  lyricOffsetMs,
  onClose,
  onNudgeOffset,
  onResetOffset,
  onSetOffset,
}: Readonly<{
  baselineRef: RefObject<PositionBaseline>;
  initialTarget: number | null;
  isPlaying: boolean;
  /** Synced lines on the lyric clock, before any offset. */
  lines: ReadonlyArray<LineRef>;
  lyricOffsetMs: number;
  onClose: () => void;
  onNudgeOffset: (deltaMs: number) => void;
  onResetOffset: () => void;
  onSetOffset: (offsetMs: number) => void;
}>) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  // The line to tap, and the last line tapped or skipped; the next target
  // comes after it.
  const [target, setTarget] = useState(initialTarget);
  const [cursor, setCursor] = useState(-1);
  const [taps, setTaps] = useState(0);

  const latest = useRef({ lines, lyricOffsetMs, isPlaying, target, onClose, onNudgeOffset });
  useEffect(() => {
    latest.current = { lines, lyricOffsetMs, isPlaying, target, onClose, onNudgeOffset };
  });

  const positionNow = () => {
    const { isPlaying: playing } = latest.current;
    return interpolatePosition(baselineRef.current, performance.now(), playing);
  };

  // Keep the current target while it can still be heard; pick another once
  // it was tapped, skipped or missed, and look again when it would be missed.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const pick = () => {
      const { lines: all, lyricOffsetMs: offset, isPlaying: playing, target: current } = latest.current;
      const position = positionNow();
      const currentLine = current === null ? undefined : all[current];
      const keep = current !== null && current > cursor && currentLine
        && !isTapTargetStale(currentLine, position, offset);
      const next = keep ? current : pickTapTarget(all, position, offset, { after: cursor });
      setTarget(next);
      const line = next === null ? undefined : all[next];
      if (line && playing) {
        timer = setTimeout(pick, Math.max(250, line.start_ms + offset + TAP_STALE_MS - position));
      }
    };
    timer = setTimeout(pick, 0);
    return () => clearTimeout(timer);
    // positionNow reads refs only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor, lines, isPlaying, baselineRef]);

  // Focus the panel so its shortcuts and Tab order start here.
  useEffect(() => {
    panelRef.current?.focus({ preventScroll: true });
  }, []);

  // [ and ] nudge, Escape closes, wherever focus is in the window.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      const { onNudgeOffset: nudge, onClose: close } = latest.current;
      if (event.key === '[') nudge(-NUDGE_STEP_MS);
      else if (event.key === ']') nudge(NUDGE_STEP_MS);
      else if (event.key === 'Escape') close();
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const targetLine = target === null ? undefined : lines[target];
  const canTap = isPlaying && targetLine !== undefined;

  const tap = () => {
    if (!canTap || target === null) return;
    onSetOffset(offsetForTap(targetLine, positionNow()));
    setTaps((n) => n + 1);
    setCursor(target);
  };

  let prompt = 'Tap when you hear';
  if (!targetLine) prompt = 'No lines left in this song';
  else if (!isPlaying) prompt = 'Play the song, then tap when you hear';

  return (
    <div
      ref={panelRef}
      className="sync-panel"
      role="group"
      aria-labelledby={titleId}
      tabIndex={-1}
    >
      <div className="sync-panel-header">
        <div className="sync-panel-heading">
          <h3 id={titleId} className="sync-panel-title">Adjust sync</h3>
          {lyricOffsetMs !== 0 && <p className="sync-readout-note">Saved for this song</p>}
        </div>
        <div className="sync-panel-header-actions">
          <button
            type="button"
            className="sync-text-btn"
            onClick={onResetOffset}
            disabled={lyricOffsetMs === 0}
          >
            Reset
          </button>
          <button type="button" className="sync-done-btn" onClick={onClose}>Done</button>
        </div>
      </div>

      <div className={`sync-tap${canTap ? '' : ' is-idle'}${targetLine ? '' : ' is-empty'}`}>
        <button
          type="button"
          className="sync-tap-button"
          aria-disabled={!canTap || undefined}
          aria-label={targetLine ? `${prompt}: ${targetLine.text}` : prompt}
          // On press, not release: a click lands as late as the finger lifts.
          onPointerDown={(event) => {
            if (event.button === 0) tap();
          }}
          onKeyDown={(event) => {
            if ((event.key === 'Enter' || event.key === ' ') && !event.repeat) {
              event.preventDefault();
              tap();
            }
          }}
        >
          <span className="sync-tap-prompt">
            <IconTap />
            {prompt}
          </span>
          {targetLine && <span className="sync-tap-line">{targetLine.text}</span>}
          {taps > 0 && <span key={taps} className="sync-tap-flash" aria-hidden="true" />}
        </button>
        {targetLine && (
          <button
            type="button"
            className="sync-tap-skip"
            onClick={() => target !== null && setCursor(target)}
            title="Use a later line"
          >
            Skip
          </button>
        )}
      </div>
    </div>
  );
}

function IconTap() {
  return (
    <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <circle cx="10" cy="10" r="2.5" fill="currentColor" stroke="none" />
      <circle cx="10" cy="10" r="5.5" opacity="0.7" />
      <circle cx="10" cy="10" r="8.5" opacity="0.35" />
    </svg>
  );
}
