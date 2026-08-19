import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

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
  const style = isGliding
    ? {
      '--glide-shift': `${overflowPx}px`,
      transform: `translateX(${-overflowPx * revealProgress}px)`,
    } as CSSProperties
    : undefined;

  return (
    <div className={`${className} ${isGliding ? 'is-gliding' : ''}`} ref={viewportRef}>
      <div className={contentClassName} ref={contentRef} style={style}>
        {children}
      </div>
    </div>
  );
}
