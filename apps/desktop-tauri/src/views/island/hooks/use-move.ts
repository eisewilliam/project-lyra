import { useEffect, useRef } from 'react';
import { getCurrentWindow, currentMonitor } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import { saveIslandPosition, setOverlayPosition } from '@/utils/tauri-commands';

const TOP_DOCK_SNAP_PX = 80;
const SURFACE_LABEL = 'island';

const noop = (...args: unknown[]) => { if (args) return; };

export function snapToTopEdge(value: number, topEdge: number) {
  return value <= topEdge + TOP_DOCK_SNAP_PX ? topEdge : value;
}

export async function setIslandPanelPosition(x: number, y: number) {
  await setOverlayPosition(SURFACE_LABEL, x, y);
}

export function useIslandMove({
  ensureWindowReady,
  setIsDocked,
  setLocked,
}: {
  ensureWindowReady: () => Promise<void>;
  setIsDocked: React.Dispatch<React.SetStateAction<boolean>>;
  setLocked: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  const saveTimerRef = useRef<number | null>(null);

  useEffect(() => {
    let unlistenLock: (() => void) | undefined;
    let unlistenMove: (() => void) | undefined;

    (async () => {
      await ensureWindowReady();
      const win = getCurrentWindow();

      unlistenLock = await listen<boolean>('island-lock-changed', (e) => {
        setLocked(e.payload);
      });

      unlistenMove = await win.onMoved(async ({ payload }) => {
        try {
          const monitor = await currentMonitor();
          if (!monitor) return;

          const snappedY = snapToTopEdge(payload.y, monitor.position.y);
          setIsDocked(snappedY <= monitor.position.y + 1);

          if (snappedY !== payload.y) {
            await setIslandPanelPosition(payload.x, snappedY);
          }

          if (saveTimerRef.current) {
            globalThis.clearTimeout(saveTimerRef.current);
          }
          saveTimerRef.current = globalThis.setTimeout(() => {
            saveIslandPosition(payload.x, snappedY).catch(noop);
          }, 250);
        } catch (error) {
          console.error(error);
        }
      });
    })().catch((error) => {
      console.error(error);
    });

    return () => {
      unlistenLock?.();
      unlistenMove?.();
      if (saveTimerRef.current) globalThis.clearTimeout(saveTimerRef.current);
    };
  }, [ensureWindowReady, setIsDocked, setLocked]);
}
