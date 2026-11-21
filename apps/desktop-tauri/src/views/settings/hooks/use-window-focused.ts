import { useSyncExternalStore } from 'react';

function subscribe(onChange: () => void) {
  globalThis.addEventListener('focus', onChange);
  globalThis.addEventListener('blur', onChange);
  return () => {
    globalThis.removeEventListener('focus', onChange);
    globalThis.removeEventListener('blur', onChange);
  };
}

export function useWindowFocused(): boolean {
  return useSyncExternalStore(subscribe, () => document.hasFocus());
}
