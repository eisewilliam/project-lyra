import type { LineRef } from './types';

/** One press of Earlier or Later. */
export const NUDGE_STEP_MS = 100;
/** The host clamps offsets to this, either way. */
export const OFFSET_LIMIT_MS = 30_000;
/** A tap target is at least this far ahead, so there is time to read it. */
export const TAP_LEAD_MS = 1200;
/** A target this long past its expected start was missed; move on. */
export const TAP_STALE_MS = 6000;

/** Offsets are signed: positive shows lyrics later, as in lyra-core. */
function seconds(ms: number): string {
  return `${(Math.abs(ms) / 1000).toFixed(ms % 100 === 0 ? 1 : 2)} s`;
}

/** "Original timing", "0.3 s later", "1.25 s earlier". */
export function describeOffset(ms: number): string {
  if (ms === 0) return 'Original timing';
  return `${seconds(ms)} ${ms > 0 ? 'later' : 'earlier'}`;
}

/** "+0.3 s" or "−1.25 s", for the menu. */
export function formatOffsetShort(ms: number): string {
  return `${ms > 0 ? '+' : '−'}${seconds(ms)}`;
}

function singable(line: LineRef | undefined): line is LineRef {
  return Boolean(line?.text.trim());
}

/** The first line with words that Lyra will highlight at least `leadMs`
 * from now, after `after` when given. Null when none is left. */
export function pickTapTarget(
  lines: ReadonlyArray<LineRef>,
  positionMs: number,
  offsetMs: number,
  options: Readonly<{ after?: number; leadMs?: number }> = {},
): number | null {
  const lead = options.leadMs ?? TAP_LEAD_MS;
  for (let i = (options.after ?? -1) + 1; i < lines.length; i++) {
    const line = lines[i];
    if (singable(line) && line.start_ms + offsetMs >= positionMs + lead) return i;
  }
  return null;
}

/** True once the target is so far past where Lyra expects it that the
 * singer has surely sung it. */
export function isTapTargetStale(line: LineRef, positionMs: number, offsetMs: number): boolean {
  return positionMs > line.start_ms + offsetMs + TAP_STALE_MS;
}

/** The offset that makes `line` start at the moment of the tap. */
export function offsetForTap(line: LineRef, tapPositionMs: number): number {
  const offset = Math.round((tapPositionMs - line.start_ms) / 10) * 10;
  return Math.max(-OFFSET_LIMIT_MS, Math.min(OFFSET_LIMIT_MS, offset));
}
