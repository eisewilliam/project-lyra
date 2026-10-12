import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import type { UpdateInfo } from '@/types/tauri-contracts';
import { getUpdateStatus } from '@/utils/tauri-commands';

/**
 * The app version and background update state. Loads once, then follows the
 * host's `update-status` events; `null` until the first load settles.
 */
export function useUpdateStatus(): UpdateInfo | null {
  const [info, setInfo] = useState<UpdateInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    getUpdateStatus()
      .then((next) => {
        if (!cancelled) setInfo(next);
      })
      .catch(() => undefined);
    void listen<UpdateInfo>('update-status', (event) => setInfo(event.payload))
      .then((stop) => {
        if (cancelled) stop();
        else unlisten = stop;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  return info;
}
