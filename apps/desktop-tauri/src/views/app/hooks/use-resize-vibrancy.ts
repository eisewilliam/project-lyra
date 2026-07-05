import { useEffect } from 'react';
import {
  applyMainVibrancy,
  clearMainVibrancy,
} from '@/utils/tauri-commands';
import { noop } from '../utils';

export function useResizeVibrancy() {
  useEffect(() => {
    let resizeTimer: number | null = null;

    const handleResize = () => {
      document.body.dataset.resizing = 'true';

      if (resizeTimer) {
        globalThis.clearTimeout(resizeTimer);
      } else {
        clearMainVibrancy().catch(noop);
      }

      resizeTimer = globalThis.setTimeout(() => {
        resizeTimer = null;
        delete document.body.dataset.resizing;
        applyMainVibrancy().catch(noop);
      }, 200);
    };

    globalThis.addEventListener('resize', handleResize);
    return () => {
      globalThis.removeEventListener('resize', handleResize);
      if (resizeTimer) {
        globalThis.clearTimeout(resizeTimer);
      }
    };
  }, []);
}
