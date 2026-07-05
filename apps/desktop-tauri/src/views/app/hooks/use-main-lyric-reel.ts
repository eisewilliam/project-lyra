import { useEffect, type RefObject } from 'react';

export function useMainLyricReel({
  activeLine,
  karaokeMode,
  lyricsCount,
  lyricsPaneRef,
  lyricsContainerRef,
  lyricsRef,
  reelUriRef,
  trackUri,
}: {
  activeLine: number | null;
  karaokeMode: boolean;
  lyricsCount: number;
  lyricsPaneRef: RefObject<HTMLElement | null>;
  lyricsContainerRef: RefObject<HTMLDivElement | null>;
  lyricsRef: RefObject<(HTMLButtonElement | null)[]>;
  reelUriRef: RefObject<string>;
  trackUri: string;
}) {
  useEffect(() => {
    const pane = lyricsPaneRef.current;
    const container = lyricsContainerRef.current;
    if (!pane || !container) return;

    const songChanged = trackUri !== reelUriRef.current;
    reelUriRef.current = trackUri;

    if (karaokeMode || activeLine === null) {
      container.style.transform = 'translateY(0)';
      return;
    }

    const el = lyricsRef.current[activeLine];
    if (!el) return;

    const reduceMotion = globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const raf = requestAnimationFrame(() => {
      const target = pane.clientHeight / 2
        - container.offsetTop
        - el.offsetTop
        - el.offsetHeight / 2;
      const noGlide = reduceMotion || songChanged;
      container.style.transition = noGlide ? 'none' : '';
      container.style.transform = `translateY(${target}px)`;
      if (noGlide) {
        container.getBoundingClientRect();
        container.style.transition = '';
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [
    activeLine,
    karaokeMode,
    lyricsCount,
    lyricsContainerRef,
    lyricsPaneRef,
    lyricsRef,
    reelUriRef,
    trackUri,
  ]);
}
