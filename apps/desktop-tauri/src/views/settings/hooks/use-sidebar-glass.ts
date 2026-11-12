import { useLayoutEffect, useState, useSyncExternalStore, type RefObject } from 'react';
import type { SidebarGlass } from '@/types/tauri-contracts';
import { detectHostOs } from '@/utils/os';
import { setSettingsSidebarGlass } from '@/utils/tauri-commands';

const isMac = detectHostOs() === 'macos';
const reducedTransparency = globalThis.matchMedia('(prefers-reduced-transparency: reduce)');

function subscribeReducedTransparency(onChange: () => void) {
  reducedTransparency.addEventListener('change', onChange);
  return () => reducedTransparency.removeEventListener('change', onChange);
}

/**
 * Floats native Liquid Glass behind the sidebar, inset from the window edges
 * like System Settings on macOS 26. Returns whether the sidebar should be laid
 * out for it: inset, rounded and clear, with the page's backdrop cut away
 * where the glass sits (`--sidebar-glass-hole` on the shell).
 *
 * Until the host answers, the page assumes glass, so the rect it measures is
 * the one it keeps. Before macOS 26 the host says no and the sidebar goes back
 * to the window's own material; with Reduce Transparency the page never asks.
 */
export function useSidebarGlass(
  shellRef: RefObject<HTMLElement | null>,
  sidebarRef: RefObject<HTMLElement | null>,
): boolean {
  const [supported, setSupported] = useState(isMac);
  const reduced = useSyncExternalStore(subscribeReducedTransparency, () => reducedTransparency.matches);
  const wanted = supported && !reduced;

  useLayoutEffect(() => {
    const shell = shellRef.current;
    const sidebar = sidebarRef.current;
    if (!isMac || !shell || !sidebar) return;
    if (!wanted) {
      shell.style.removeProperty('--sidebar-glass-hole');
      setSettingsSidebarGlass(null).catch(() => undefined);
      return;
    }

    let cancelled = false;
    let placed = '';
    const place = () => {
      const glass = measure(sidebar);
      // Both boxes report on observing; send each new place once.
      const key = [glass.x, glass.y, glass.width, glass.height, glass.radius, shell.clientWidth, shell.clientHeight].join();
      if (key === placed) return;
      placed = key;
      shell.style.setProperty('--sidebar-glass-hole', holePath(shell.clientWidth, shell.clientHeight, glass));
      setSettingsSidebarGlass(glass)
        .then((showing) => {
          // A no under Reduce Transparency passes when it is turned off; any
          // other no means this Mac has no glass.
          if (!showing && !cancelled && !reducedTransparency.matches) setSupported(false);
        })
        .catch(() => {
          if (!cancelled) setSupported(false);
        });
    };
    // Fires once on observing, then whenever the window or sidebar resizes.
    const observer = new ResizeObserver(place);
    observer.observe(shell);
    observer.observe(sidebar);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [wanted, shellRef, sidebarRef]);

  return wanted;
}

function measure(sidebar: HTMLElement): SidebarGlass {
  const rect = sidebar.getBoundingClientRect();
  const radius = Number.parseFloat(getComputedStyle(sidebar).borderTopLeftRadius) || 0;
  return { x: rect.left, y: rect.top, width: rect.width, height: rect.height, radius };
}

/** The whole window less a rounded rect where the glass sits, as a clip-path. */
function holePath(width: number, height: number, { x, y, width: w, height: h, radius }: SidebarGlass): string {
  const r = Math.min(radius, w / 2, h / 2);
  const arc = `A${r} ${r} 0 0 1`;
  return (
    `path(evenodd, "M0 0H${width}V${height}H0Z` +
    `M${x + r} ${y}H${x + w - r}${arc} ${x + w} ${y + r}V${y + h - r}${arc} ${x + w - r} ${y + h}` +
    `H${x + r}${arc} ${x} ${y + h - r}V${y + r}${arc} ${x + r} ${y}Z")`
  );
}
