import { useCallback, useEffect, useRef, useState } from 'react';
import type { PlayerSessionInfo } from '@/types/tauri-contracts';
import { getPlayerSessions } from '@/utils/tauri-commands';

/**
 * Loads the playback sessions Lyra's player adapters saw in their latest
 * poll through the `get_player_sessions` command, for the Players
 * diagnostics section.
 *
 * - Fetches once on mount and again whenever `refresh` is called; the
 *   Players page calls it every few seconds while it is open.
 * - `sessions` is `null` until the first load settles and `[]` when no player
 *   is visible. `refresh` resolves after the list updates and rejects on
 *   failure so callers can show honest feedback.
 * - Responses that arrive after unmount are ignored.
 */
export function usePlayerSessions() {
  const [sessions, setSessions] = useState<PlayerSessionInfo[] | null>(null);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    const next = await getPlayerSessions();
    if (mountedRef.current) setSessions(next);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    getPlayerSessions()
      .then((next) => {
        if (mountedRef.current) setSessions(next);
      })
      .catch(() => {
        if (mountedRef.current) setSessions([]);
      });
    return () => {
      mountedRef.current = false;
    };
  }, []);

  return { sessions, refresh };
}
