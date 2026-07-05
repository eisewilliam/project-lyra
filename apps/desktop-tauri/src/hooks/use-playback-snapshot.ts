import { useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import type { RenderSnapshot } from '@/types/tauri-contracts';
import { getRenderSnapshot } from '@/utils/tauri-commands';

export function usePlaybackSnapshot({
  ensureWindowReady,
  onSnapshot,
}: {
  ensureWindowReady: () => Promise<void>;
  onSnapshot: (snapshot: RenderSnapshot) => void;
}) {
  const onSnapshotRef = useRef(onSnapshot);

  useEffect(() => {
    onSnapshotRef.current = onSnapshot;
  }, [onSnapshot]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    (async () => {
      await ensureWindowReady();
      if (cancelled) return;

      try {
        const initial = await getRenderSnapshot();
        if (!cancelled) {
          onSnapshotRef.current(initial);
        }
      } catch {
        // The next playback-tick event will repair transient startup failures.
      }

      if (cancelled) return;
      unlisten = await listen<RenderSnapshot>('playback-tick', (event) => {
        if (!cancelled) {
          onSnapshotRef.current(event.payload);
        }
      });
      if (cancelled) {
        unlisten();
      }
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [ensureWindowReady]);
}
