import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

const GLIDE_FADE_PX = 40;

export function GlidingLine({
  className,
  contentClassName,
  contentKey,
  syncProgress,
  children,
}: Readonly<{
  className: string;
  contentClassName: string;
  contentKey: string;
  syncProgress: number;
  children: ReactNode;
}>) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [overflowPx, setOverflowPx] = useState(0);

  useEffect(() => {
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
  let normalizedReveal = 0;
  if (syncProgress >= 0.78) {
    normalizedReveal = 1;
  } else if (syncProgress > 0.06) {
    normalizedReveal = (syncProgress - 0.06) / 0.72;
  }
  const revealProgress = normalizedReveal * normalizedReveal * (3 - 2 * normalizedReveal);
  const shiftPx = overflowPx * revealProgress;
  const style = isGliding
    ? {
      '--glide-shift': `${overflowPx}px`,
      transform: `translateX(${-shiftPx}px)`,
    } as CSSProperties
    : undefined;
  // Fade only the edge(s) where text is cut off, scaled by how much is hidden
  // there, so a clipped word reads as scrolling rather than truncated.
  const viewportStyle = isGliding
    ? {
      '--glide-fade-start': `${Math.min(GLIDE_FADE_PX, shiftPx)}px`,
      '--glide-fade-end': `${Math.min(GLIDE_FADE_PX, overflowPx - shiftPx)}px`,
    } as CSSProperties
    : undefined;

  return (
    <div
      className={`${className} ${isGliding ? 'is-gliding' : ''}`}
      ref={viewportRef}
      style={viewportStyle}
    >
      <div className={contentClassName} ref={contentRef} style={style}>
        {children}
      </div>
    </div>
  );
}
