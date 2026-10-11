import { useCallback, useEffect, useRef, useState } from 'react';

export type ShortcutFeedback = 'play' | 'pause' | 'forward' | 'back' | 'next' | 'previous';
export type ShortcutHudState = { kind: ShortcutFeedback; id: number };

const HUD_MS = 900;

/**
 * Brief confirmation for keyboard shortcuts, which otherwise act with no
 * visible cause. Clicks don't use it: their buttons already respond.
 */
export function useShortcutHud() {
  const [hud, setHud] = useState<ShortcutHudState | null>(null);
  const timerRef = useRef(0);

  const show = useCallback((kind: ShortcutFeedback) => {
    globalThis.clearTimeout(timerRef.current);
    setHud({ kind, id: performance.now() });
    timerRef.current = globalThis.setTimeout(() => setHud(null), HUD_MS);
  }, []);

  useEffect(() => () => globalThis.clearTimeout(timerRef.current), []);

  return { hud, show };
}

