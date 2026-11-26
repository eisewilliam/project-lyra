import { useCallback, useEffect, useRef, useState } from 'react';
import type { LyricLineSlim } from '@/types/tauri-contracts';
import {
  PEEK_IDLE_MS,
  computeNextPeekIndex,
  formatPeekDelta,
} from '../peek-math';

type PeekState = {
  key: string;
  index: number;
  direction: -1 | 1;
  seq: number;
};

export type PeekReturnCue = {
  seq: number;
  direction: -1 | 1;
};

const RETURN_CUE_MS = 280;

export function useMarqueePeek({
  sessionKey,
  lines,
  activeLineIndex,
  menuOpen,
  onBoundary,
}: {
  sessionKey: string;
  lines: ReadonlyArray<LyricLineSlim>;
  activeLineIndex: number | null;
  menuOpen: boolean;
  onBoundary?: (direction: -1 | 1) => void;
}) {
  const [rawPeek, setRawPeek] = useState<PeekState | null>(null);
  const [returnCue, setReturnCue] = useState<PeekReturnCue | null>(null);
  const [bumpSeq, setBumpSeq] = useState(0);

  const peekInvalid = rawPeek !== null && (
    rawPeek.key !== sessionKey
    || lines.length === 0
    || rawPeek.index >= lines.length
    || (activeLineIndex !== null && rawPeek.index === activeLineIndex)
  );
  if (peekInvalid) {
    setRawPeek(null);
  }

  const peek = peekInvalid ? null : rawPeek;

  const latestRef = useRef({
    sessionKey,
    linesLength: lines.length,
    activeLineIndex,
    onBoundary,
  });
  const peekStateRef = useRef<PeekState | null>(null);

  useEffect(() => {
    latestRef.current = {
      sessionKey,
      linesLength: lines.length,
      activeLineIndex,
      onBoundary,
    };
    peekStateRef.current = peek;
  }, [sessionKey, lines.length, activeLineIndex, onBoundary, peek]);

  useEffect(() => {
    if (!peek || menuOpen) return;
    const timer = globalThis.setTimeout(() => {
      const liveIdx = latestRef.current.activeLineIndex;
      const dir: -1 | 1 = liveIdx !== null && liveIdx < peek.index ? -1 : 1;
      peekStateRef.current = null;
      setReturnCue((prev) => ({ seq: (prev?.seq ?? 0) + 1, direction: dir }));
      setRawPeek(null);
    }, PEEK_IDLE_MS);
    return () => globalThis.clearTimeout(timer);
  }, [peek, bumpSeq, menuOpen]);

  useEffect(() => {
    if (!returnCue) return;
    const timer = globalThis.setTimeout(() => {
      setReturnCue((prev) => (prev?.seq === returnCue.seq ? null : prev));
    }, RETURN_CUE_MS);
    return () => globalThis.clearTimeout(timer);
  }, [returnCue]);

  const stepPeek = useCallback((step: -1 | 1) => {
    const latest = latestRef.current;
    const rawCurrent = peekStateRef.current;
    const current = rawCurrent && rawCurrent.key === latest.sessionKey ? rawCurrent : null;
    const transition = computeNextPeekIndex({
      currentPeek: current?.index ?? null,
      liveIndex: latest.activeLineIndex,
      totalLines: latest.linesLength,
      step,
    });

    if (transition.kind === 'noop') return;

    if (transition.kind === 'boundary') {
      if (current !== null) {
        setBumpSeq((n) => n + 1);
      }
      latest.onBoundary?.(transition.direction);
      return;
    }

    if (transition.kind === 'live') {
      peekStateRef.current = null;
      setReturnCue((prev) => ({ seq: (prev?.seq ?? 0) + 1, direction: transition.direction }));
      setRawPeek(null);
      return;
    }

    const next: PeekState = {
      key: latest.sessionKey,
      index: transition.index,
      direction: transition.direction,
      seq: (current?.seq ?? 0) + 1,
    };
    peekStateRef.current = next;
    setReturnCue(null);
    setRawPeek(next);
  }, []);

  const cancelPeek = useCallback(() => {
    if (peekStateRef.current === null) return;
    peekStateRef.current = null;
    setReturnCue(null);
    setRawPeek(null);
  }, []);

  const returnToLive = useCallback(() => {
    const rawCurrent = peekStateRef.current;
    const current = rawCurrent && rawCurrent.key === latestRef.current.sessionKey ? rawCurrent : null;
    if (!current) return;
    const liveIdx = latestRef.current.activeLineIndex;
    const dir: -1 | 1 = liveIdx !== null && liveIdx < current.index ? -1 : 1;
    peekStateRef.current = null;
    setReturnCue((prev) => ({ seq: (prev?.seq ?? 0) + 1, direction: dir }));
    setRawPeek(null);
  }, []);

  return {
    isPeeking: peek !== null,
    peekIndex: peek?.index ?? null,
    peekDirection: peek?.direction ?? 1,
    peekLine: peek ? (lines[peek.index]?.text ?? null) : null,
    peekNextLine: peek ? (lines[peek.index + 1]?.text ?? null) : null,
    peekLabel: peek ? formatPeekDelta(peek.index, activeLineIndex, lines.length) : null,
    peekSeq: peek?.seq ?? 0,
    returnCue,
    stepPeek,
    cancelPeek,
    returnToLive,
  };
}
