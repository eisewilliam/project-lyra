import { useCallback, useSyncExternalStore } from 'react';
import { useHydrated } from '@tanstack/react-router';
import { visitorPlatform, type Platform } from './site-config.ts';

// Pages are rendered on the server (prerendered at build time) and hydrated in
// the browser, where the first render must match the server's HTML. Anything
// that depends on the visitor (their platform, media queries, the query
// string) starts from the server's answer and switches once hydrated.

let detected: Platform | null | undefined;
const detectPlatform = () => (detected === undefined ? (detected = visitorPlatform()) : detected);

/** The visitor's desktop platform; null on phones, tablets, and on the server. */
export function useVisitorPlatform() {
  return useHydrated() ? detectPlatform() : null;
}

/** Whether a media query matches; false on the server and while hydrating. */
export function useMediaQuery(query: string) {
  const subscribe = useCallback((onChange: () => void) => {
    const media = window.matchMedia(query);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [query]);
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false);
}

export const usePrefersReducedMotion = () => useMediaQuery('(prefers-reduced-motion: reduce)');
