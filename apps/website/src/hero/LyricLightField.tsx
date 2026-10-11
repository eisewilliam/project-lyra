import { useEffect, useRef, useState, type RefObject } from 'react';
import { LyricLight } from './lyric-light.ts';

declare global {
  interface Window {
    // Development only: the running engine, for poking at it from the console.
    __lyricLight?: LyricLight;
  }
}

interface LyricLightFieldProps {
  playing: boolean;
  heroRef: RefObject<HTMLElement | null>;
  copyRef: RefObject<HTMLElement | null>;
  startTime: number | undefined;
  onUnsupported: () => void;
}

// Decorative hero field. Falls back to the still Resonance artwork without WebGL2.
export function LyricLightField({ playing, heroRef, copyRef, startTime, onUnsupported }: LyricLightFieldProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<LyricLight | null>(null);
  const [unsupported, setUnsupported] = useState(false);

  useEffect(() => {
    const hero = heroRef.current;
    const copy = copyRef.current;
    const canvas = canvasRef.current;
    if (!hero || !copy || !canvas) return undefined;
    const engine = LyricLight.create(canvas);
    if (!engine) {
      setUnsupported(true);
      onUnsupported();
      return undefined;
    }
    engineRef.current = engine;
    if (import.meta.env.DEV) window.__lyricLight = engine;
    if (startTime !== undefined) engine.time = startTime;

    // The light dims behind the copy itself, not the full-width copy container.
    const measure = () => {
      const box = hero.getBoundingClientRect();
      const range = document.createRange();
      const rects = [...copy.querySelectorAll('h1, p, .hero-actions > *')].map(node => {
        range.selectNodeContents(node);
        return node.matches('h1, p') ? range.getBoundingClientRect() : node.getBoundingClientRect();
      });
      const [headline] = rects;
      if (!headline) return;
      engine.resize(box.width, box.height, {
        left: Math.min(...rects.map(r => r.left)) - box.left,
        top: Math.min(...rects.map(r => r.top)) - box.top,
        right: Math.max(...rects.map(r => r.right)) - box.left,
        bottom: Math.max(...rects.map(r => r.bottom)) - box.top,
      }, headline.top + headline.height / 2 - box.top);
    };
    let pending = 0;
    const queueMeasure = () => {
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(measure);
    };
    engine.onQualityChange = queueMeasure;
    const resizeObserver = new ResizeObserver(queueMeasure);
    resizeObserver.observe(hero);
    resizeObserver.observe(copy);

    let inView = true;
    const updateVisibility = () => engine.setVisible(inView && !document.hidden);
    const intersectionObserver = new IntersectionObserver(([entry]) => {
      inView = entry?.isIntersecting ?? false;
      updateVisibility();
    });
    intersectionObserver.observe(hero);
    document.addEventListener('visibilitychange', updateVisibility);

    // A small hand-held light: on fine pointers, the cursor reveals nearby lyrics too.
    const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
    const onPointerMove = (event: PointerEvent) => {
      if (!finePointer.matches || event.pointerType !== 'mouse') return;
      const box = hero.getBoundingClientRect();
      engine.setPointer(event.clientX - box.left, event.clientY - box.top, true);
    };
    const onPointerLeave = () => engine.setPointer(0, 0, false);
    hero.addEventListener('pointermove', onPointerMove);
    hero.addEventListener('pointerleave', onPointerLeave);

    measure();
    // The hero copy rises in on load; measure again once it has settled.
    const settled = window.setTimeout(queueMeasure, 1500);
    engine.setPlaying(playing);
    return () => {
      cancelAnimationFrame(pending);
      window.clearTimeout(settled);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      document.removeEventListener('visibilitychange', updateVisibility);
      hero.removeEventListener('pointermove', onPointerMove);
      hero.removeEventListener('pointerleave', onPointerLeave);
      engine.destroy();
      engineRef.current = null;
    };
    // The engine is created once; `playing` is synchronised by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    engineRef.current?.setPlaying(playing);
  }, [playing]);

  if (unsupported) {
    return <img className="hero-art" src="/assets/resonance-light.webp" alt="" aria-hidden="true" width="1536" height="720" />;
  }
  return <canvas ref={canvasRef} className="lyric-light" aria-hidden="true" />;
}
