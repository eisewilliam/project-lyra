import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import type { MarqueeFrame } from '@/types/tauri-contracts';
import { getMarqueeFrame } from '@/utils/tauri-commands';

const noop = (...args: unknown[]) => { if (args) return; };

/**
 * The Marquee's size on its current display. The host fits the window when
 * the size settings change, the Marquee moves to a display of another width,
 * or it docks against the top edge or leaves it, then sends the result as
 * `marquee-frame`.
 */
export function useMarqueeFrame(ensureWindowReady?: () => Promise<void>): MarqueeFrame | null {
  const [frame, setFrame] = useState<MarqueeFrame | null>(null);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void (async () => {
      await ensureWindowReady?.();
      if (cancelled) return;
      const stop = await listen<MarqueeFrame>('marquee-frame', (event) => setFrame(event.payload));
      if (cancelled) {
        stop();
        return;
      }
      unlisten = stop;
      // A frame sent before the listener existed; an event since wins.
      const current = await getMarqueeFrame();
      if (!cancelled && current) setFrame((prev) => prev ?? current);
    })().catch(noop);
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [ensureWindowReady]);

  return frame;
}
