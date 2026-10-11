import { useCallback, useEffect, useRef, useState } from 'react';
import type { KnownPlayerInfo } from '@/types/tauri-contracts';
import { getKnownPlayers } from '@/utils/tauri-commands';

/**
 * Loads every player Lyra has seen (`get_known_players`), including ones not
 * running now, so their settings can be changed at any time.
 *
 * - Fetches once on mount and again whenever `refresh` is called; it never
 *   polls.
 * - `players` is `null` until the first load settles. `refresh` rejects on
 *   failure so callers can show honest feedback.
 * - Responses that arrive after unmount are ignored.
 */
export function useKnownPlayers() {
  const [players, setPlayers] = useState<KnownPlayerInfo[] | null>(null);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    const next = await getKnownPlayers();
    if (mountedRef.current) setPlayers(next);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    getKnownPlayers()
      .then((next) => {
        if (mountedRef.current) setPlayers(next);
      })
      .catch(() => {
        if (mountedRef.current) setPlayers([]);
      });
    return () => {
      mountedRef.current = false;
    };
  }, []);

  return { players, refresh };
}
