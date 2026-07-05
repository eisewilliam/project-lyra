import { useEffect, useRef, type RefObject } from 'react';
import { getCurrentWindow, currentMonitor } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import { saveIslandPosition, setOverlayPosition } from '@/utils/tauri-commands';

const TOP_DOCK_SNAP_PX = 80;
const SURFACE_LABEL = 'island';

const noop = (...args: unknown[]) => { if (args) return; };

type IslandMovePayload = {
  x: number;
  y: number;
};

export function snapToTopEdge(value: number, topEdge: number) {
  return value <= topEdge + TOP_DOCK_SNAP_PX ? topEdge : value;
}

export async function setIslandPanelPosition(x: number, y: number) {
  await setOverlayPosition(SURFACE_LABEL, x, y);
}

function clearIslandPositionSave(saveTimerRef: RefObject<number | null>) {
  if (!saveTimerRef.current) return;
  globalThis.clearTimeout(saveTimerRef.current);
  saveTimerRef.current = null;
}

function scheduleIslandPositionSave(
  saveTimerRef: RefObject<number | null>,
  x: number,
  y: number,
) {
  clearIslandPositionSave(saveTimerRef);
  saveTimerRef.current = globalThis.setTimeout(() => {
    saveIslandPosition(x, y).catch(noop);
  }, 250);
}

async function handleIslandMoved(
  payload: IslandMovePayload,
  saveTimerRef: RefObject<number | null>,
  setIsDocked: React.Dispatch<React.SetStateAction<boolean>>,
) {
  try {
    const monitor = await currentMonitor();
    if (!monitor) return;

    const snappedY = snapToTopEdge(payload.y, monitor.position.y);
    setIsDocked(snappedY <= monitor.position.y + 1);

    if (snappedY !== payload.y) {
      await setIslandPanelPosition(payload.x, snappedY);
    }

    scheduleIslandPositionSave(saveTimerRef, payload.x, snappedY);
  } catch (error) {
    console.error(error);
  }
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
        await handleIslandMoved(payload, saveTimerRef, setIsDocked);
      });
    })().catch((error) => {
      console.error(error);
    });

    return () => {
      unlistenLock?.();
      unlistenMove?.();
      clearIslandPositionSave(saveTimerRef);
    };
  }, [ensureWindowReady, setIsDocked, setLocked]);
}
