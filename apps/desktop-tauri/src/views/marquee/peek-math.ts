export const PEEK_STEP_PX = 36;
export const PEEK_IDLE_MS = 3000;
export const PEEK_ACCUM_RESET_MS = 180;
export const PEEK_DISCRETE_NOTCH_PX = 48;

export function normalizeWheelDeltaY(deltaY: number, deltaMode: number): number {
  if (deltaMode === 1) return deltaY * 28;
  if (deltaMode === 2) return deltaY * 120;
  return deltaY;
}

export function consumePeekWheelStep(
  accumulated: number,
  deltaPx: number,
  stepPx = PEEK_STEP_PX,
): { step: -1 | 0 | 1; nextAccumulated: number } {
  if (!Number.isFinite(deltaPx) || deltaPx === 0) {
    return { step: 0, nextAccumulated: accumulated };
  }

  const base = accumulated !== 0 && Math.sign(deltaPx) !== Math.sign(accumulated)
    ? 0
    : accumulated;
  const total = base + deltaPx;

  if (Math.abs(total) < stepPx) {
    return { step: 0, nextAccumulated: total };
  }

  const step: -1 | 1 = total > 0 ? 1 : -1;
  if (Math.abs(deltaPx) >= PEEK_DISCRETE_NOTCH_PX) {
    return { step, nextAccumulated: 0 };
  }

  const remainder = total - step * stepPx;
  const nextAccumulated = Math.abs(remainder) >= stepPx ? 0 : remainder;
  return { step, nextAccumulated };
}

export type PeekTransition =
  | { kind: 'peek'; index: number; direction: 1 | -1 }
  | { kind: 'live'; direction: 1 | -1 }
  | { kind: 'boundary'; direction: 1 | -1 }
  | { kind: 'noop' };

export function computeNextPeekIndex({
  currentPeek,
  liveIndex,
  totalLines,
  step,
}: {
  currentPeek: number | null;
  liveIndex: number | null;
  totalLines: number;
  step: -1 | 1;
}): PeekTransition {
  if (totalLines <= 0) {
    return { kind: 'noop' };
  }

  if (currentPeek === null) {
    if (liveIndex === null) {
      if (step > 0) {
        return { kind: 'peek', index: 0, direction: 1 };
      }
      return { kind: 'boundary', direction: -1 };
    }

    const target = liveIndex + step;
    if (target < 0 || target >= totalLines) {
      return { kind: 'boundary', direction: step };
    }
    return { kind: 'peek', index: target, direction: step };
  }

  const target = currentPeek + step;
  if (target < 0 || target >= totalLines) {
    return { kind: 'boundary', direction: step };
  }
  if (liveIndex !== null && target === liveIndex) {
    return { kind: 'live', direction: step };
  }
  return { kind: 'peek', index: target, direction: step };
}

export function formatPeekDelta(
  peekIndex: number,
  liveIndex: number | null,
  totalLines: number,
): string {
  if (liveIndex !== null) {
    const diff = peekIndex - liveIndex;
    return diff > 0 ? `↓ ${diff}` : `↑ ${Math.abs(diff)}`;
  }
  return `${peekIndex + 1}/${totalLines}`;
}
