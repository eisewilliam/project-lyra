import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react';
import type { PaintRange, ScreenEdgeMotion, ScreenEdgeMotionMap } from '../types';

const EDGE_MOTION_MS = 640;
const REEL_TRANSITION_MS = 620;
const PAINT_RANGE_BUFFER_VIEWPORTS = 0.6;

type LineMetric = {
  top: number;
  height: number;
};

type ReelViewportMetric = {
  paneHeight: number;
  containerTop: number;
};

function clampMotionDelay(ms: number) {
  return Math.max(0, Math.min(REEL_TRANSITION_MS, Math.round(ms)));
}

export function useMainLyricReel({
  activeLine,
  karaokeMode,
  lyricsCount,
  lyricsPaneRef,
  lyricsContainerRef,
  lyricsRef,
  reelUriRef,
  setScreenEdgeMotion,
  trackUri,
}: {
  activeLine: number | null;
  karaokeMode: boolean;
  lyricsCount: number;
  lyricsPaneRef: RefObject<HTMLElement | null>;
  lyricsContainerRef: RefObject<HTMLDivElement | null>;
  lyricsRef: RefObject<(HTMLButtonElement | null)[]>;
  reelUriRef: RefObject<string>;
  setScreenEdgeMotion: Dispatch<SetStateAction<ScreenEdgeMotionMap>>;
  trackUri: string;
}) {
  const [paintRange, setPaintRange] = useState<PaintRange | null>(null);
  const prevLineRef = useRef<number | null>(null);
  const prevTargetRef = useRef<number | null>(null);
  const targetCacheRef = useRef<number[]>([]);
  const lineMetricsCacheRef = useRef<(LineMetric | null)[]>([]);
  const viewportMetricRef = useRef<ReelViewportMetric | null>(null);
  const edgeTimersRef = useRef<Record<number, number[]>>({});

  const clearEdgeTimer = useCallback((index: number) => {
    const timers = edgeTimersRef.current[index];
    if (timers) {
      for (const timer of timers) {
        globalThis.clearTimeout(timer);
      }
      delete edgeTimersRef.current[index];
    }
  }, []);

  const triggerEdgeMotion = useCallback((index: number, motion: ScreenEdgeMotion, delayMs = 0) => {
    clearEdgeTimer(index);
    const timers: number[] = [];

    const startTimer = globalThis.setTimeout(() => {
      setScreenEdgeMotion((current) => ({ ...current, [index]: motion }));
      const endTimer = globalThis.setTimeout(() => {
        setScreenEdgeMotion((current) => {
          if (current[index] !== motion) return current;
          const next = { ...current };
          delete next[index];
          return next;
        });
        delete edgeTimersRef.current[index];
      }, EDGE_MOTION_MS);
      timers.push(endTimer);
    }, clampMotionDelay(delayMs));

    timers.push(startTimer);
    edgeTimersRef.current[index] = timers;
  }, [clearEdgeTimer, setScreenEdgeMotion]);

  const clearEdgeMotion = useCallback(() => {
    for (const timers of Object.values(edgeTimersRef.current)) {
      for (const timer of timers) {
        globalThis.clearTimeout(timer);
      }
    }
    edgeTimersRef.current = {};
    setScreenEdgeMotion({});
  }, [setScreenEdgeMotion]);

  const publishPaintRange = useCallback((target: number | null) => {
    const viewportMetric = viewportMetricRef.current;
    const lineMetrics = lineMetricsCacheRef.current;
    if (target === null || !viewportMetric || lyricsCount === 0) {
      setPaintRange(null);
      return;
    }

    const { paneHeight, containerTop } = viewportMetric;
    const bufferPx = paneHeight * PAINT_RANGE_BUFFER_VIEWPORTS;
    const minY = -bufferPx;
    const maxY = paneHeight + bufferPx;
    let start = -1;
    let end = -1;

    for (let index = 0; index < lyricsCount; index++) {
      const metric = lineMetrics[index];
      if (!metric) continue;

      const lineTop = containerTop + target + metric.top;
      const lineBottom = lineTop + metric.height;
      const inRange = lineBottom >= minY && lineTop <= maxY;

      if (inRange) {
        if (start === -1) start = index;
        end = index;
      } else if (start !== -1 && lineTop > maxY) {
        break;
      }
    }

    if (activeLine !== null) {
      start = start === -1 ? activeLine : Math.min(start, activeLine);
      end = end === -1 ? activeLine : Math.max(end, activeLine);
    }

    if (start === -1 || end === -1) {
      setPaintRange(null);
      return;
    }

    setPaintRange((current) => {
      if (current?.start === start && current.end === end) return current;
      return { start, end };
    });
  }, [activeLine, lyricsCount]);

  const applyScreenEdgeMotions = useCallback((fromTarget: number, toTarget: number) => {
    const viewportMetric = viewportMetricRef.current;
    const lineMetrics = lineMetricsCacheRef.current;
    if (!viewportMetric || lyricsCount === 0) return;

    const { paneHeight, containerTop } = viewportMetric;
    let leavingIndex: number | null = null;
    let leavingDelay = Number.POSITIVE_INFINITY;

    for (let index = 0; index < lyricsCount; index++) {
      const metric = lineMetrics[index];
      if (!metric) continue;

      const beforeTop = containerTop + fromTarget + metric.top;
      const beforeBottom = beforeTop + metric.height;
      const afterTop = containerTop + toTarget + metric.top;
      const wasVisible = beforeBottom > 0 && beforeTop < paneHeight;

      if (!wasVisible && beforeTop >= paneHeight && afterTop > 0) {
        break;
      }

      if (wasVisible && afterTop <= 0 && beforeBottom > 0) {
        const distance = beforeTop - afterTop;
        const delay = beforeTop > 0 && distance > 0
          ? (beforeTop / distance) * REEL_TRANSITION_MS
          : 0;

        if (delay < leavingDelay) {
          leavingDelay = delay;
          leavingIndex = index;
        }
      }
    }

    if (leavingIndex !== null) {
      triggerEdgeMotion(leavingIndex, 'is-leaving-edge', leavingDelay);
    }
  }, [lyricsCount, triggerEdgeMotion]);

  const measureReel = useCallback(() => {
    const pane = lyricsPaneRef.current;
    const container = lyricsContainerRef.current;
    if (!pane || !container || lyricsCount === 0) {
      targetCacheRef.current = [];
      lineMetricsCacheRef.current = [];
      viewportMetricRef.current = null;
      setPaintRange(null);
      clearEdgeMotion();
      return;
    }

    const paneHeight = pane.clientHeight;
    const paneCenter = paneHeight / 2;
    const containerTop = container.offsetTop;
    const targets = new Array<number>(lyricsCount);
    const lineMetrics = new Array<LineMetric | null>(lyricsCount);

    for (let index = 0; index < lyricsCount; index++) {
      const el = lyricsRef.current[index];
      if (el) {
        const top = el.offsetTop;
        const height = el.offsetHeight;
        lineMetrics[index] = { top, height };
        targets[index] = paneCenter - containerTop - top - height / 2;
      } else {
        lineMetrics[index] = null;
        targets[index] = Number.NaN;
      }
    }

    targetCacheRef.current = targets;
    lineMetricsCacheRef.current = lineMetrics;
    viewportMetricRef.current = { paneHeight, containerTop };

    const activeTarget = activeLine !== null ? targets[activeLine] : undefined;
    publishPaintRange(activeTarget !== undefined && Number.isFinite(activeTarget) ? activeTarget : null);
  }, [
    activeLine,
    clearEdgeMotion,
    lyricsCount,
    lyricsContainerRef,
    lyricsPaneRef,
    lyricsRef,
    publishPaintRange,
  ]);

  useEffect(() => {
    const pane = lyricsPaneRef.current;
    const container = lyricsContainerRef.current;
    if (!pane || !container || lyricsCount === 0) {
      targetCacheRef.current = [];
      lineMetricsCacheRef.current = [];
      viewportMetricRef.current = null;
      setPaintRange(null);
      return;
    }

    let raf = requestAnimationFrame(measureReel);

    if (typeof ResizeObserver === 'undefined') {
      globalThis.addEventListener('resize', measureReel);
      return () => {
        cancelAnimationFrame(raf);
        globalThis.removeEventListener('resize', measureReel);
      };
    }

    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measureReel);
    });

    observer.observe(pane);
    observer.observe(container);
    for (let index = 0; index < lyricsCount; index++) {
      const el = lyricsRef.current[index];
      if (el) observer.observe(el);
    }

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [
    lyricsCount,
    lyricsContainerRef,
    lyricsPaneRef,
    lyricsRef,
    measureReel,
    trackUri,
  ]);

  useEffect(() => {
    const pane = lyricsPaneRef.current;
    const container = lyricsContainerRef.current;
    if (!pane || !container) return;

    const songChanged = trackUri !== reelUriRef.current;
    reelUriRef.current = trackUri;

    if (karaokeMode || activeLine === null) {
      container.style.transform = 'translate3d(0, 0px, 0)';
      prevTargetRef.current = 0;
      prevLineRef.current = activeLine;
      publishPaintRange(null);
      clearEdgeMotion();
      return;
    }

    const reduceMotion = globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Determine if this is a seek (large jump) vs natural line progression
    const prevLine = prevLineRef.current;
    const lineJump = prevLine !== null ? Math.abs(activeLine - prevLine) : 0;
    const isSeek = lineJump > 2;
    const isNaturalAdvance = prevLine !== null && activeLine === prevLine + 1;
    prevLineRef.current = activeLine;

    let edgeMotionRaf = 0;
    let paintRangeRaf = 0;
    const raf = requestAnimationFrame(() => {
      const el = lyricsRef.current[activeLine];
      const cachedTarget = targetCacheRef.current[activeLine];
      let target: number | null = null;
      if (Number.isFinite(cachedTarget)) {
        target = cachedTarget as number;
      } else if (el) {
        target = pane.clientHeight / 2 - container.offsetTop - el.offsetTop - el.offsetHeight / 2;
      }
      if (target === null) return;
      const noGlide = reduceMotion || songChanged;

      if (noGlide) {
        container.style.transition = 'none';
      } else if (isSeek) {
        container.style.transition = 'transform 420ms cubic-bezier(0.4, 0, 0.2, 1)';
      } else {
        container.style.transition = '';
      }

      const previousTarget = prevTargetRef.current;
      const shouldApplyEdgeMotion = !noGlide && !isSeek && isNaturalAdvance && previousTarget !== null;

      container.style.transform = `translate3d(0, ${target}px, 0)`;
      prevTargetRef.current = target;
      paintRangeRaf = requestAnimationFrame(() => {
        publishPaintRange(target);
      });

      if (shouldApplyEdgeMotion) {
        edgeMotionRaf = requestAnimationFrame(() => {
          applyScreenEdgeMotions(previousTarget, target);
        });
      }

      if (noGlide) {
        container.getBoundingClientRect();
        container.style.transition = '';
      }
    });
    return () => {
      cancelAnimationFrame(raf);
      cancelAnimationFrame(edgeMotionRaf);
      cancelAnimationFrame(paintRangeRaf);
    };
  }, [
    activeLine,
    karaokeMode,
    lyricsCount,
    lyricsContainerRef,
    lyricsPaneRef,
    lyricsRef,
    applyScreenEdgeMotions,
    clearEdgeMotion,
    publishPaintRange,
    reelUriRef,
    trackUri,
  ]);

  useEffect(() => {
    const edgeTimers = edgeTimersRef.current;
    return () => {
      for (const timers of Object.values(edgeTimers)) {
        for (const timer of timers) {
          globalThis.clearTimeout(timer);
        }
      }
    };
  }, []);

  return { paintRange };
}
