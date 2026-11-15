import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import type { DiscordPresenceStatus } from '@/types/tauri-contracts';
import { getDiscordPresenceStatus } from '@/utils/tauri-commands';

/**
 * Whether Lyra can publish to Discord and whether Discord is connected.
 * Loads once, then follows the host's `discord-presence-status` events;
 * `null` until the first load settles.
 */
export function useDiscordPresenceStatus(): DiscordPresenceStatus | null {
  const [status, setStatus] = useState<DiscordPresenceStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    getDiscordPresenceStatus()
      .then((next) => {
        if (!cancelled) setStatus(next);
      })
      .catch(() => undefined);
    void listen<DiscordPresenceStatus>('discord-presence-status', (event) => setStatus(event.payload))
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

  return status;
}
