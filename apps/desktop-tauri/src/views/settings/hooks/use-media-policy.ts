import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import type { MediaPolicyView } from '@/types/tauri-contracts';
import { getMediaPolicy } from '@/utils/tauri-commands';

/**
 * Loads the media-following policy (which apps and media Lyra follows)
 * through `get_media_policy` and keeps it current with
 * `media-policy-changed` events, which any window's change triggers.
 *
 * - `policy` is `null` until the first load resolves.
 * - `applyPolicy` stores the result returned by a policy command so the UI
 *   updates without waiting for the event.
 * - The event listener is removed on unmount; a load that resolves after
 *   unmount is ignored.
 */
export function useMediaPolicy() {
  const [policy, setPolicy] = useState<MediaPolicyView | null>(null);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    getMediaPolicy()
      .then((next) => {
        if (!cancelled) setPolicy(next);
      })
      .catch(() => {});
    listen<MediaPolicyView>('media-policy-changed', (event) => setPolicy(event.payload))
      .then((stop) => {
        if (cancelled) stop();
        else unlisten = stop;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  return { policy, applyPolicy: setPolicy };
}
