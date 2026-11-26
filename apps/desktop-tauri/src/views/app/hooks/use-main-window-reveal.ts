import { useEffect, type RefObject } from 'react';
import { listen } from '@tauri-apps/api/event';
import type { MainWindowReveal } from '@/types/tauri-contracts';

const EASE_OUT = 'cubic-bezier(0.22, 1, 0.36, 1)';
const HIDDEN_FRAME_FALLBACK_MS = 120;

function clampUnit(value: number): number {
  return Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
}

function shouldSkipReveal(): boolean {
  if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return true;
  }
  return document.documentElement.dataset.lowPower === 'true';
}

function animateSafe(
  el: HTMLElement | null,
  keyframes: Keyframe[],
  options: KeyframeAnimationOptions,
  bag: Animation[],
) {
  if (!el || typeof el.animate !== 'function') return;
  bag.push(el.animate(keyframes, options));
}

export function useMainWindowReveal({
  windowRef,
  rimRef,
}: {
  windowRef: RefObject<HTMLElement | null>;
  rimRef: RefObject<HTMLDivElement | null>;
}) {
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    let activeAnimations: Animation[] = [];
    let rafId = 0;
    let fallbackTimer = 0;

    const cleanupCurrent = () => {
      cancelAnimationFrame(rafId);
      rafId = 0;
      globalThis.clearTimeout(fallbackTimer);
      fallbackTimer = 0;
      for (const anim of activeAnimations) {
        anim.cancel();
      }
      activeAnimations = [];
    };

    void listen<MainWindowReveal>('main-window-reveal', (event) => {
      if (cancelled) return;
      cleanupCurrent();
      if (shouldSkipReveal()) return;

      const root = windowRef.current;
      if (!root) return;

      const { from_x, from_y, was_hidden, from_marquee } = event.payload;
      if (!was_hidden && !from_marquee) return;

      const fx = clampUnit(from_x);
      const fy = clampUnit(from_y);

      const ambient = root.querySelector<HTMLElement>('.ambient-bg');
      const sidebar = root.querySelector<HTMLElement>('.player-sidebar');
      const lyricsPane = root.querySelector<HTMLElement>('.lyrics-pane');
      const winControls = root.querySelector<HTMLElement>('.win-controls');
      const rim = rimRef.current;

      if (rim) {
        rim.style.setProperty('--reveal-origin-x', `${Math.round(50 + fx * 50)}%`);
        rim.style.setProperty('--reveal-origin-y', `${Math.round(50 + fy * 50)}%`);
        rim.setAttribute('data-reveal-kind', was_hidden ? 'unfold' : 'focus');
      }

      const created: Animation[] = [];
      if (was_hidden) {
        animateSafe(
          ambient,
          [
            { opacity: 0.25, transform: 'scale(1.025)' },
            { opacity: 1, transform: 'scale(1)' },
          ],
          { duration: 200, easing: EASE_OUT, fill: 'backwards' },
          created,
        );
        const sdx = Math.round(fx * 10);
        const sdy = Math.round(fy * 10);
        animateSafe(
          sidebar,
          [
            { opacity: 0, transform: `translate3d(${sdx}px, ${sdy}px, 0) scale(0.985)` },
            { opacity: 1, transform: 'translate3d(0px, 0px, 0) scale(1)' },
          ],
          { duration: 180, easing: EASE_OUT, fill: 'backwards' },
          created,
        );
        const ldx = Math.round(fx * 14);
        const ldy = Math.round(fy * 14);
        animateSafe(
          lyricsPane,
          [
            { opacity: 0, transform: `translate3d(${ldx}px, ${ldy}px, 0) scale(0.99)` },
            { opacity: 1, transform: 'translate3d(0px, 0px, 0) scale(1)' },
          ],
          { duration: 200, delay: 18, easing: EASE_OUT, fill: 'backwards' },
          created,
        );
        animateSafe(
          winControls,
          [{ opacity: 0 }, { opacity: 1 }],
          { duration: 140, delay: 20, easing: 'ease-out', fill: 'backwards' },
          created,
        );
        if (from_marquee) {
          animateSafe(
            rim,
            [{ opacity: 0 }, { opacity: 0.85, offset: 0.28 }, { opacity: 0 }],
            { duration: 220, easing: 'ease-out', fill: 'backwards' },
            created,
          );
        }
      } else {
        const sdx = Math.round(fx * 4);
        const sdy = Math.round(fy * 4);
        animateSafe(
          sidebar,
          [
            { transform: `translate3d(${sdx}px, ${sdy}px, 0)` },
            { transform: 'translate3d(0px, 0px, 0)' },
          ],
          { duration: 150, easing: EASE_OUT },
          created,
        );
        const ldx = Math.round(fx * 6);
        const ldy = Math.round(fy * 6);
        animateSafe(
          lyricsPane,
          [
            { transform: `translate3d(${ldx}px, ${ldy}px, 0)` },
            { transform: 'translate3d(0px, 0px, 0)' },
          ],
          { duration: 170, delay: 12, easing: EASE_OUT },
          created,
        );
        animateSafe(
          rim,
          [{ opacity: 0 }, { opacity: 1, offset: 0.24 }, { opacity: 0 }],
          { duration: 190, easing: 'ease-out' },
          created,
        );
      }

      activeAnimations = created;
      if (created.length === 0) return;

      if (document.hidden) {
        for (const anim of created) {
          anim.pause();
        }
        const playAll = () => {
          cancelAnimationFrame(rafId);
          rafId = 0;
          globalThis.clearTimeout(fallbackTimer);
          fallbackTimer = 0;
          if (cancelled || activeAnimations !== created) return;
          for (const anim of created) {
            if (anim.playState === 'paused') {
              anim.play();
            }
          }
        };
        rafId = requestAnimationFrame(playAll);
        fallbackTimer = globalThis.setTimeout(playAll, HIDDEN_FRAME_FALLBACK_MS);
      }
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });

    return () => {
      cancelled = true;
      unlisten?.();
      cleanupCurrent();
    };
  }, [rimRef, windowRef]);
}
