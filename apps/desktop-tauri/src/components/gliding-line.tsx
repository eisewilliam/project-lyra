import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react';
import { interpolatePosition, type LyricWord, type PositionBaseline } from '@/utils/playback-sync';

const GLIDE_FADE_PX = 40;

/**
 * The playback clock of a word-timed line. With it the glide follows the
 * sung position every frame; without it the glide steps with each snapshot.
 */
export type GlideClock = {
  words: LyricWord[];
  baselineRef: RefObject<PositionBaseline>;
  isPlaying: boolean;
  /** False while the page or surface is hidden: nothing is drawn. */
  running: boolean;
};

/** How far through the glide (0..1) a line at `progress` (0..1) should be. */
function glideReveal(progress: number) {
  let normalized = 0;
  if (progress >= 0.78) {
    normalized = 1;
  } else if (progress > 0.06) {
    normalized = (progress - 0.06) / 0.72;
  }
  return normalized * normalized * (3 - 2 * normalized);
}

/** Progress (0..1) through the sung span of a line's words, or null. */
function wordSpanProgress(words: LyricWord[], posMs: number): number | null {
  const first = words[0];
  const last = words.at(-1);
  if (!first || !last || last.end_ms <= first.start_ms) return null;
  return Math.max(0, Math.min(1, (posMs - first.start_ms) / (last.end_ms - first.start_ms)));
}

export function GlidingLine({
  className,
  contentClassName,
  contentKey,
  syncProgress,
  clock,
  children,
}: Readonly<{
  className: string;
  contentClassName: string;
  contentKey: string;
  syncProgress: number;
  clock?: GlideClock;
  children: ReactNode;
}>) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [overflowPx, setOverflowPx] = useState(0);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return;

    const updateOverflow = () => {
      const nextOverflow = Math.max(0, Math.ceil(content.scrollWidth - viewport.clientWidth));
      setOverflowPx((current) => (current === nextOverflow ? current : nextOverflow));
    };

    updateOverflow();

    if (typeof ResizeObserver === 'undefined') {
      globalThis.addEventListener('resize', updateOverflow);
      return () => globalThis.removeEventListener('resize', updateOverflow);
    }

    const observer = new ResizeObserver(updateOverflow);
    observer.observe(viewport);
    observer.observe(content);
    return () => observer.disconnect();
  }, [contentKey]);

  const isGliding = overflowPx > 0;
  const words = clock?.words;
  const baselineRef = clock?.baselineRef;
  const isPlaying = clock?.isPlaying ?? false;
  const running = clock?.running ?? false;
  const isLive = isGliding && words !== undefined && words.length > 0;

  // Live: draw the glide from the interpolated position on every frame,
  // writing the DOM directly so React doesn't re-render per frame. Each
  // snapshot changes `syncProgress` and restarts the loop, which picks up a
  // seek; the loop stops early once the glide has finished.
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!isLive || !viewport || !content || !words || !baselineRef) return;

    let raf = 0;
    // Shifts are never negative, so the first frame always writes.
    let lastShift = -1;
    let lastFadeStart = Number.NaN;
    let lastFadeEnd = Number.NaN;
    const draw = () => {
      const pos = interpolatePosition(baselineRef.current, performance.now(), isPlaying);
      const reveal = glideReveal(wordSpanProgress(words, pos) ?? syncProgress);
      const shift = overflowPx * reveal;
      if (Math.abs(shift - lastShift) >= 0.05) {
        lastShift = shift;
        content.style.transform = `translateX(${-shift}px)`;
      }
      const fadeStart = Math.round(Math.min(GLIDE_FADE_PX, shift) * 2) / 2;
      const fadeEnd = Math.round(Math.min(GLIDE_FADE_PX, overflowPx - shift) * 2) / 2;
      if (fadeStart !== lastFadeStart) {
        lastFadeStart = fadeStart;
        viewport.style.setProperty('--glide-live-start', `${fadeStart}px`);
      }
      if (fadeEnd !== lastFadeEnd) {
        lastFadeEnd = fadeEnd;
        viewport.style.setProperty('--glide-live-end', `${fadeEnd}px`);
      }
      if (isPlaying && running && reveal < 1) raf = requestAnimationFrame(draw);
    };
    draw();
    return () => {
      cancelAnimationFrame(raf);
      content.style.removeProperty('transform');
      viewport.style.removeProperty('--glide-live-start');
      viewport.style.removeProperty('--glide-live-end');
    };
  }, [contentKey, isLive, overflowPx, words, baselineRef, isPlaying, running, syncProgress]);

  const shiftPx = overflowPx * glideReveal(syncProgress);
  const style = isGliding && !isLive
    ? {
      '--glide-shift': `${overflowPx}px`,
      transform: `translateX(${-shiftPx}px)`,
    } as CSSProperties
    : undefined;
  // Fade only the edge(s) where text is cut off, scaled by how much is hidden
  // there, so a clipped word reads as scrolling rather than truncated.
  const viewportStyle = isGliding && !isLive
    ? {
      '--glide-fade-start': `${Math.min(GLIDE_FADE_PX, shiftPx)}px`,
      '--glide-fade-end': `${Math.min(GLIDE_FADE_PX, overflowPx - shiftPx)}px`,
    } as CSSProperties
    : undefined;

  return (
    <div
      className={`${className} ${isGliding ? 'is-gliding' : ''} ${isLive ? 'is-live' : ''}`}
      ref={viewportRef}
      style={viewportStyle}
    >
      <div className={contentClassName} ref={contentRef} style={style}>
        {children}
      </div>
    </div>
  );
}
