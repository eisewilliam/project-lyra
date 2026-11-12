import { useLayoutEffect, useState, type RefObject } from 'react';

type ScrollEdges = Readonly<{ above: boolean; below: boolean }>;

/**
 * Whether a scroller has content hidden above and below what it shows, for
 * the hairlines that mark where settings pass under the title and footer.
 * Rechecks on scroll and whenever the scroller or its content resizes; pass a
 * new `contentKey` when the content element is replaced.
 */
export function useScrollEdges(ref: RefObject<HTMLElement | null>, contentKey: unknown): ScrollEdges {
  const [edges, setEdges] = useState<ScrollEdges>({ above: false, below: false });

  useLayoutEffect(() => {
    const scroller = ref.current;
    if (!scroller) return;
    const update = () => {
      const above = scroller.scrollTop > 2;
      const below = scroller.scrollTop + scroller.clientHeight < scroller.scrollHeight - 2;
      setEdges((prev) => (prev.above === above && prev.below === below ? prev : { above, below }));
    };
    update();
    scroller.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(scroller);
    for (const child of scroller.children) observer.observe(child);
    return () => {
      scroller.removeEventListener('scroll', update);
      observer.disconnect();
    };
  }, [ref, contentKey]);

  return edges;
}
