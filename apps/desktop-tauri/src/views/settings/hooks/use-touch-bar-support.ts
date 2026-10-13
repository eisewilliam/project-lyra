import { useEffect, useState } from 'react';
import type { TouchBarSupport } from '@/types/tauri-contracts';
import { getTouchBarSupport } from '@/utils/tauri-commands';

/**
 * Whether this Mac has a Touch Bar, and whether Lyra can add its Control
 * Strip button. Loads once; `null` until it settles or if the host can't say.
 */
export function useTouchBarSupport(): TouchBarSupport | null {
  const [support, setSupport] = useState<TouchBarSupport | null>(null);

  useEffect(() => {
    let cancelled = false;
    getTouchBarSupport()
      .then((next) => {
        if (!cancelled) setSupport(next);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return support;
}
