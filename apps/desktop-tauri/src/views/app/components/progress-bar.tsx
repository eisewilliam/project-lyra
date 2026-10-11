import { useCallback, useEffect, useRef, type RefObject } from 'react';
import type { TrackRef } from '@/types/tauri-contracts';
import type { PositionBaseline } from '@/utils/playback-sync';
import { playbackSeekMs } from '@/utils/tauri-commands';
import type { LineRef } from '../types';
import { formatMs, noop } from '../utils';

/** Last line starting at or before `ms` (lyric time), by binary search. */
function lineAt(lines: ReadonlyArray<LineRef>, ms: number): string | null {
  let lo = 0;
  let hi = lines.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((lines[mid]?.start_ms ?? Infinity) <= ms) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  const text = found >= 0 ? lines[found]?.text.trim() : '';
  return text ? text : null;
}

export function ProgressBar({
  baselineRef,
  canSeek,
  clampedPositionMs,
  durationMs,
  handleMouseDown,
  hasTrack,
  positionLabelRef,
  progressFillRef,
  progressPct,
  progressTrackRef,
  setPositionMs,
  track,
  lyrics,
  lyricOffsetMs,
}: Readonly<{
  baselineRef: RefObject<PositionBaseline>;
  canSeek: boolean;
  clampedPositionMs: number;
  durationMs: number;
  handleMouseDown: (event: React.MouseEvent<HTMLDivElement>) => void;
  hasTrack: boolean;
  positionLabelRef: RefObject<HTMLSpanElement | null>;
  progressFillRef: RefObject<HTMLDivElement | null>;
  progressPct: number;
  progressTrackRef: RefObject<HTMLDivElement | null>;
  setPositionMs: React.Dispatch<React.SetStateAction<number>>;
  track: TrackRef | null;
  /** Synced lines, for the scrub preview; empty when none are loaded. */
  lyrics: ReadonlyArray<LineRef>;
  lyricOffsetMs: number;
}>) {
  // Players can report a track before its duration (Spotify music videos
  // read 0 for ~1–2 s after a change). Show an inert bar until it arrives
  // rather than a misleading "0:00" total.
  const durationKnown = durationMs > 0;
  const isIndeterminate = hasTrack && !durationKnown;
  const durationLabel = isIndeterminate ? '–:––' : formatMs(durationMs);
  let trackStateClass = '';
  if (!hasTrack) trackStateClass = 'is-placeholder';
  else if (isIndeterminate) trackStateClass = 'is-indeterminate';
  else if (!canSeek) trackStateClass = 'is-readonly';

  // Scrub preview: hovering or dragging the bar shows the time and the lyric
  // line at that point. Written straight to the DOM — no re-render per move.
  const previewRef = useRef<HTMLDivElement | null>(null);
  const previewTimeRef = useRef<HTMLSpanElement | null>(null);
  const previewLineRef = useRef<HTMLSpanElement | null>(null);
  const latestRef = useRef({ lyrics, lyricOffsetMs, durationMs });
  useEffect(() => {
    latestRef.current = { lyrics, lyricOffsetMs, durationMs };
  }, [lyrics, lyricOffsetMs, durationMs]);
  const hoverRef = useRef(false);
  const pressedRef = useRef(false);

  const updatePreview = useCallback((clientX: number) => {
    const preview = previewRef.current;
    const trackEl = progressTrackRef.current;
    const { lyrics: lines, lyricOffsetMs: offset, durationMs: duration } = latestRef.current;
    if (!preview || !trackEl || duration <= 0) return;
    const rect = trackEl.getBoundingClientRect();
    const barRect = preview.parentElement?.getBoundingClientRect() ?? rect;
    const pct = Math.min(1, Math.max(0, (clientX - rect.left) / Math.max(1, rect.width)));
    const ms = pct * duration;
    if (previewTimeRef.current) previewTimeRef.current.textContent = formatMs(ms);
    const line = lineAt(lines, ms - offset);
    if (previewLineRef.current) {
      previewLineRef.current.textContent = line ?? '';
      previewLineRef.current.hidden = !line;
    }
    preview.style.setProperty('--preview-x', `${rect.left - barRect.left + pct * rect.width}px`);
    preview.classList.add('is-visible');
  }, [progressTrackRef]);

  const hidePreview = useCallback(() => {
    if (hoverRef.current || pressedRef.current) return;
    previewRef.current?.classList.remove('is-visible');
  }, []);

  const onTrackMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    handleMouseDown(event);
    if (!durationKnown || !canSeek) return;
    pressedRef.current = true;
    updatePreview(event.clientX);
    const move = (e: MouseEvent) => updatePreview(e.clientX);
    const up = () => {
      pressedRef.current = false;
      globalThis.removeEventListener('mousemove', move);
      globalThis.removeEventListener('mouseup', up);
      hidePreview();
    };
    globalThis.addEventListener('mousemove', move);
    globalThis.addEventListener('mouseup', up);
  };

  const handleProgressKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!track || track.duration_ms === 0 || !canSeek) return;
    let targetMs: number;
    if (event.key === 'ArrowLeft') {
      targetMs = Math.max(0, clampedPositionMs - 5000);
    } else if (event.key === 'ArrowRight') {
      targetMs = Math.min(track.duration_ms, clampedPositionMs + 5000);
    } else {
      return;
    }
    event.preventDefault();
    setPositionMs(targetMs);
    const now = performance.now();
    baselineRef.current = { ms: targetMs, at: now, targetMs: targetMs, targetAt: now, blendDur: 1 };
    playbackSeekMs(targetMs).catch(noop);
  };

  return (
    <div className="progress-bar">
      <span className="time-label" ref={positionLabelRef}>{formatMs(clampedPositionMs)}</span>
      <div
        className={`progress-track ${trackStateClass}`}
        ref={progressTrackRef}
        onMouseDown={onTrackMouseDown}
        onMouseEnter={(event) => {
          if (!durationKnown) return;
          hoverRef.current = true;
          updatePreview(event.clientX);
        }}
        onMouseMove={(event) => {
          if (hoverRef.current) updatePreview(event.clientX);
        }}
        onMouseLeave={() => {
          hoverRef.current = false;
          hidePreview();
        }}
        onKeyDown={handleProgressKeyDown}
        role="slider"
        tabIndex={hasTrack && canSeek && durationKnown ? 0 : -1}
        aria-label="Playback progress"
        aria-readonly={!canSeek}
        aria-disabled={!durationKnown}
        aria-valuemin={0}
        aria-valuemax={durationMs}
        aria-valuenow={clampedPositionMs}
        aria-valuetext={durationKnown
          ? `${formatMs(clampedPositionMs)} of ${formatMs(durationMs)}`
          : formatMs(clampedPositionMs)}
      >
        <div
          className="progress-fill"
          ref={progressFillRef}
          style={{ transform: `scaleX(${Math.max(0, Math.min(1, progressPct / 100))})` }}
        ></div>
      </div>
      <span className="time-label">{durationLabel}</span>
      <div className="scrub-preview" ref={previewRef} aria-hidden="true">
        <span className="scrub-preview-time" ref={previewTimeRef} />
        <span className="scrub-preview-line" ref={previewLineRef} hidden />
      </div>
    </div>
  );
}
