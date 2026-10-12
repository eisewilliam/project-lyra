import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import type { IslandFrame } from '@/types/tauri-contracts';
import { getIslandFrame } from '@/utils/tauri-commands';

const noop = (...args: unknown[]) => { if (args) return; };

/**
 * The Marquee's size on its current display. The host fits the window when
 * the size settings change or the Marquee moves to another display or under
 * the notch, then sends the result as `island-frame`.
 */
export function useIslandFrame(ensureWindowReady?: () => Promise<void>): IslandFrame | null {
  const [frame, setFrame] = useState<IslandFrame | null>(null);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void (async () => {
      await ensureWindowReady?.();
      if (cancelled) return;
      const stop = await listen<IslandFrame>('island-frame', (event) => setFrame(event.payload));
      if (cancelled) {
        stop();
        return;
      }
      unlisten = stop;
      // A frame sent before the listener existed; an event since wins.
      const current = await getIslandFrame();
      if (!cancelled && current) setFrame((prev) => prev ?? current);
    })().catch(noop);
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [ensureWindowReady]);

  return frame;
}
