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

// How far the copy's entrance has moved `node` from where it comes to rest:
// the vertical part of its own transform and its ancestors', up to `copy`.
function rise(node: Element, copy: Element) {
  let shift = 0;
  for (let element: Element | null = node; element && element !== copy; element = element.parentElement) {
    const { transform } = getComputedStyle(element);
    if (transform !== 'none') shift += new DOMMatrixReadOnly(transform).m42;
  }
  return shift;
}

// Decorative hero field. Falls back to the still Resonance artwork without WebGL2.
export function LyricLightField({ playing, heroRef, copyRef, startTime, onUnsupported }: LyricLightFieldProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<LyricLight | null>(null);
  // The engine starts a frame after mounting; this keeps `playing` for it.
  const playingRef = useRef(playing);
  const [unsupported, setUnsupported] = useState(false);

  useEffect(() => {
    const hero = heroRef.current;
    const copy = copyRef.current;
    const canvas = canvasRef.current;
    if (!hero || !copy || !canvas) return undefined;

    const setUp = () => {
      const engine = LyricLight.create(canvas);
      if (!engine) {
        setUnsupported(true);
        onUnsupported();
        return undefined;
      }
      engineRef.current = engine;
      if (import.meta.env.DEV) window.__lyricLight = engine;
      if (startTime !== undefined) engine.time = startTime;

      // The light dims behind the copy itself, not the full-width copy container,
      // measured where the copy comes to rest once it has risen in.
      const measure = () => {
        const box = hero.getBoundingClientRect();
        const range = document.createRange();
        // Hidden elements measure as an empty box at the corner; leave them out.
        const rects = [...copy.querySelectorAll('.hero-line, p, .hero-actions > *')].map(node => {
          range.selectNodeContents(node);
          const rect = node.matches('.hero-line, p') ? range.getBoundingClientRect() : node.getBoundingClientRect();
          const shift = rise(node, copy);
          return { left: rect.left, right: rect.right, top: rect.top - shift, bottom: rect.bottom - shift, height: rect.height };
        }).filter(rect => rect.right > rect.left && rect.height > 0);
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
      // A tap on the staff plucks it; taps on the copy and its links are theirs.
      const onPointerDown = (event: PointerEvent) => {
        if (event.target instanceof Element && event.target.closest('a, button, .hero-copy h1, .hero-copy p')) return;
        const box = hero.getBoundingClientRect();
        engine.tap(event.clientX - box.left, event.clientY - box.top);
      };
      hero.addEventListener('pointermove', onPointerMove);
      hero.addEventListener('pointerleave', onPointerLeave);
      hero.addEventListener('pointerdown', onPointerDown);

      measure();
      engine.setPlaying(playingRef.current);
      return () => {
        cancelAnimationFrame(pending);
        resizeObserver.disconnect();
        intersectionObserver.disconnect();
        document.removeEventListener('visibilitychange', updateVisibility);
        hero.removeEventListener('pointermove', onPointerMove);
        hero.removeEventListener('pointerleave', onPointerLeave);
        hero.removeEventListener('pointerdown', onPointerDown);
        engine.destroy();
        engineRef.current = null;
      };
    };

    // Set the light up once the copy's entrance is under way. The entrance
    // runs on the compositor, so compiling the shader and building the clefs
    // cannot stall it.
    let tearDown: (() => void) | undefined;
    let timer = 0;
    const frame = requestAnimationFrame(() => {
      timer = window.setTimeout(() => { tearDown = setUp(); });
    });
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
      tearDown?.();
    };
    // The engine is created once; `playing` is synchronised by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    playingRef.current = playing;
    engineRef.current?.setPlaying(playing);
  }, [playing]);

  if (unsupported) {
    return <img className="hero-art" src="/assets/resonance-light.webp" alt="" aria-hidden="true" width="1536" height="720" />;
  }
  return <canvas ref={canvasRef} className="lyric-light" aria-hidden="true" />;
}
