import { useEffect, useState } from 'react';

function shouldSkipExit(): boolean {
  if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return true;
  }
  return document.documentElement.dataset.surfaceVisible === 'false';
}

/**
 * Keeps a closing surface/panel mounted briefly so its exit animation can
 * finish before React unmounts it. Skips waiting under Reduce Motion or
 * while the surface is hidden.
 */
export function useExitPresence(open: boolean, durationMs: number): {
  mounted: boolean;
  closing: boolean;
} {
  const [prevOpen, setPrevOpen] = useState(open);
  const [leaving, setLeaving] = useState(false);

  if (prevOpen !== open) {
    setPrevOpen(open);
    setLeaving(!open && !shouldSkipExit());
  }

  useEffect(() => {
    if (open || !leaving) return;
    const timer = globalThis.setTimeout(() => setLeaving(false), durationMs);
    return () => globalThis.clearTimeout(timer);
  }, [durationMs, leaving, open]);

  return { mounted: open || leaving, closing: !open && leaving };
}
