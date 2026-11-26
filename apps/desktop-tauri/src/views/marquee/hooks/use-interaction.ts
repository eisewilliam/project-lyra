import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
  type RefObject,
  type WheelEvent,
} from 'react';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { DockImpulse, MarqueeDock, MarqueeDragFeedback, PlaybackCaps } from '@/types/tauri-contracts';
import { detectHostOs } from '@/utils/os';
import {
  PEEK_ACCUM_RESET_MS,
  consumePeekWheelStep,
  normalizeWheelDeltaY,
} from '../peek-math';
import {
  beginMarqueeDrag,
  endMarqueeDrag,
  marqueePointerInside,
  moveMarqueeDrag,
  openMainWindow,
  playbackNext,
  playbackPlayPause,
  playbackPrevious,
  playbackRaise,
  resizeMarquee,
} from '@/utils/tauri-commands';

/** What a click does, by the marquee region pressed (`data-marquee-action`). */
export type MarqueeAction = 'open' | 'toggle' | 'raise' | 'peek-return';

/** A press that moves farther than this is a drag, not a click. */
const DRAG_THRESHOLD_PX = 4;
/** Opening the main window takes a double-click: two clicks this close in
    time and place. A stray single click on the lyrics does nothing. */
const DOUBLE_CLICK_MS = 450;
const DOUBLE_CLICK_SLOP_PX = 6;
/** Horizontal trackpad travel that counts as a swipe to skip. */
const SWIPE_THRESHOLD_PX = 70;
const SWIPE_COOLDOWN_MS = 700;
const SWIPE_RESET_MS = 180;
/** Distance from a side edge (px) that reveals that edge's resize handle. */
const EDGE_ZONE_PX = 20;
/** While hovered, re-check the pointer this often so effects never linger. */
const HOVER_CHECK_MS = 400;

/**
 * On macOS the marquee is a non-activating panel: WebKit may deliver an enter
 * but never the matching leave while another app is active, which left hover
 * effects stuck on. There, hover and edge proximity come only from the host's
 * native tracking area (`marquee-hover`, `marquee-edge`); DOM events are used
 * on the other platforms.
 */
const NATIVE_HOVER = detectHostOs() === 'macos';

export type MarqueeEdge = -1 | 0 | 1;

const noop = (...args: unknown[]) => { if (args) return; };

type ResizeDrag = { edge: 'left' | 'right'; anchorX: number | null; width: number; pointerX: number };

type Press = {
  pointerId: number;
  action: MarqueeAction;
  /** Pressed on an edge handle: resize from that side instead of moving. */
  resizeEdge: ResizeDrag['edge'] | null;
  startX: number;
  startY: number;
  /** Window frame in physical px and the display's pixels per point, once
      the async lookup returns (used for edge resize). */
  origin: { position: { x: number; y: number } | null; width: number; pixelRatio: number } | null;
  lastResize: ResizeDrag | null;
  dragging: boolean;
  dragBegan: boolean;
};

function resizeEdgeFor(target: EventTarget | null, dock: MarqueeDock): ResizeDrag['edge'] | null {
  const el = target instanceof Element ? target.closest('[data-marquee-resize]') : null;
  const edge = el?.getAttribute('data-marquee-resize');
  if (edge === 'left' && !dock.left) return 'left';
  if (edge === 'right' && !dock.right) return 'right';
  return null;
}

function resizeDragFor(press: Press, pointerX: number): ResizeDrag | null {
  const { origin, resizeEdge } = press;
  if (!origin || resizeEdge === null) return null;
  const fromLeft = resizeEdge === 'left';
  const x = origin.position?.x;
  const dx = pointerX - press.startX;
  return {
    edge: resizeEdge,
    anchorX: x === undefined ? null : x + (fromLeft ? origin.width : 0),
    width: origin.width / origin.pixelRatio + (fromLeft ? -dx : dx),
    pointerX,
  };
}

function actionFor(target: EventTarget | null): MarqueeAction {
  const el = target instanceof Element ? target.closest('[data-marquee-action]') : null;
  const action = el?.getAttribute('data-marquee-action');
  if (action === 'toggle' || action === 'raise' || action === 'peek-return') return action;
  return 'open';
}

function clearPullVariables(el: HTMLElement | null) {
  if (!el) return;
  el.removeAttribute('data-pulling');
  el.style.removeProperty('--pull-x');
  el.style.removeProperty('--pull-y');
  el.style.removeProperty('--pull-top');
  el.style.removeProperty('--pull-right');
  el.style.removeProperty('--pull-bottom');
  el.style.removeProperty('--pull-left');
}

function applyPullFeedback(el: HTMLElement | null, pullX: number, pullY: number) {
  if (!el) return;
  const isPulling = Math.abs(pullX) > 0.005 || Math.abs(pullY) > 0.005;
  el.style.setProperty('--pull-x', pullX.toFixed(3));
  el.style.setProperty('--pull-y', pullY.toFixed(3));
  el.style.setProperty('--pull-top', Math.max(0, pullY).toFixed(3));
  el.style.setProperty('--pull-right', Math.max(0, -pullX).toFixed(3));
  el.style.setProperty('--pull-bottom', Math.max(0, -pullY).toFixed(3));
  el.style.setProperty('--pull-left', Math.max(0, pullX).toFixed(3));
  if (isPulling) el.setAttribute('data-pulling', 'true');
  else el.removeAttribute('data-pulling');
}

function applySwipeFeedback(
  el: HTMLElement | null,
  offsetPx: number,
  progress: number,
  direction: 'next' | 'previous',
) {
  if (!el) return;
  el.style.setProperty('--swipe-x', `${offsetPx.toFixed(2)}px`);
  el.style.setProperty('--swipe-progress', progress.toFixed(3));
  el.setAttribute('data-swiping', direction);
}

function clearSwipeFeedback(el: HTMLElement | null) {
  if (!el) return;
  el.removeAttribute('data-swiping');
  el.style.removeProperty('--swipe-x');
  el.style.removeProperty('--swipe-progress');
}

/**
 * Marquee pointer model:
 * - hover (native tracking area on macOS, DOM events elsewhere) reveals the
 *   transport control; nearing a free side edge reveals that edge's resize
 *   handle (unlocked only);
 * - a click runs the pressed region's action — cover raises the player, the
 *   meter toggles playback; a double-click anywhere else opens the main
 *   window;
 * - a press that travels past a few pixels drives the host's liquid drag
 *   (attaching flush to any edge or corner with surface-tension peel);
 * - dragging an edge handle resizes it while the opposite edge stays fixed;
 * - a horizontal two-finger swipe skips tracks.
 * With click-through on, the window receives no mouse input at all.
 */
export function useMarqueeInteraction({
  ensureWindowReady,
  locked,
  dock,
  panelRef,
  onDockImpulse,
  onSwipeSkip,
  onOpenMain,
  onPeekStep,
  onPeekReturn,
  onContextMenuOpen,
  onCancelPeek,
  caps,
  onTogglePlaying,
}: {
  ensureWindowReady: () => Promise<void>;
  locked: boolean;
  dock: MarqueeDock;
  panelRef: RefObject<HTMLDivElement | null>;
  onDockImpulse?: (impulse: DockImpulse) => void;
  onSwipeSkip?: (direction: 'next' | 'previous') => void;
  onOpenMain?: () => void;
  onPeekStep?: (step: -1 | 1) => void;
  onPeekReturn?: () => void;
  onContextMenuOpen?: () => void;
  onCancelPeek?: () => void;
  caps: PlaybackCaps;
  onTogglePlaying: () => void;
}) {
  const [nativeHover, setNativeHover] = useState(false);
  const [domHover, setDomHover] = useState(false);
  const [nativeEdge, setNativeEdge] = useState<MarqueeEdge>(0);
  const [domEdge, setDomEdge] = useState<MarqueeEdge>(0);
  const [dragging, setDragging] = useState(false);
  const [resizeEdge, setResizeEdge] = useState<ResizeDrag['edge'] | null>(null);
  const [transportPressed, setTransportPressed] = useState(false);
  const pressRef = useRef<Press | null>(null);
  const moveRafRef = useRef(0);
  const pendingMoveRef = useRef<{ dx: number; dy: number } | null>(null);
  const dragChainRef = useRef<Promise<void>>(Promise.resolve());
  const moveInFlightRef = useRef<Promise<void> | null>(null);
  const pendingResizeRef = useRef<ResizeDrag | null>(null);
  const resizeInFlightRef = useRef<Promise<void> | null>(null);
  const swipeRef = useRef({ accumulated: 0, lockedUntil: 0, resetTimer: 0 });
  const peekWheelRef = useRef({ accumulated: 0, lastVerticalAt: 0, resetTimer: 0 });
  const lastOpenClickRef = useRef<{ at: number; x: number; y: number } | null>(null);
  const onDockImpulseRef = useRef(onDockImpulse);
  const onSwipeSkipRef = useRef(onSwipeSkip);
  const onOpenMainRef = useRef(onOpenMain);
  const onPeekStepRef = useRef(onPeekStep);
  const onPeekReturnRef = useRef(onPeekReturn);
  const onContextMenuOpenRef = useRef(onContextMenuOpen);
  const onCancelPeekRef = useRef(onCancelPeek);

  useEffect(() => {
    onDockImpulseRef.current = onDockImpulse;
  }, [onDockImpulse]);

  useEffect(() => {
    onSwipeSkipRef.current = onSwipeSkip;
  }, [onSwipeSkip]);

  useEffect(() => {
    onOpenMainRef.current = onOpenMain;
  }, [onOpenMain]);

  useEffect(() => {
    onPeekStepRef.current = onPeekStep;
    onPeekReturnRef.current = onPeekReturn;
    onContextMenuOpenRef.current = onContextMenuOpen;
    onCancelPeekRef.current = onCancelPeek;
  }, [onPeekStep, onPeekReturn, onContextMenuOpen, onCancelPeek]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      await ensureWindowReady();
      if (cancelled) return;
      const unlistenHover = await listen<boolean>('marquee-hover', (event) => {
        setNativeHover(event.payload);
        if (!event.payload) setNativeEdge(0);
      });
      const unlistenEdge = await listen<MarqueeEdge>('marquee-edge', (event) => setNativeEdge(event.payload));
      const unlistenFeedback = await listen<MarqueeDragFeedback>('marquee-drag-feedback', (event) => {
        const { pull_x, pull_y, impulse } = event.payload;
        applyPullFeedback(panelRef.current, pull_x, pull_y);
        if (impulse) onDockImpulseRef.current?.(impulse);
      });
      unlisten = () => {
        unlistenHover();
        unlistenEdge();
        unlistenFeedback();
      };
      if (cancelled) unlisten();
    })().catch(noop);
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [ensureWindowReady, panelRef]);

  // Safety net for a lost exit event: while hovered, confirm the pointer is
  // still over the marquee; if not, reverse the hover effects at once.
  useEffect(() => {
    if (!NATIVE_HOVER || !nativeHover) return;
    const timer = globalThis.setInterval(() => {
      marqueePointerInside()
        .then((inside) => {
          if (inside) return;
          setNativeHover(false);
          setNativeEdge(0);
        })
        .catch(noop);
    }, HOVER_CHECK_MS);
    return () => globalThis.clearInterval(timer);
  }, [nativeHover]);

  const runAction = useCallback((action: MarqueeAction, x: number, y: number) => {
    if (action === 'peek-return') {
      lastOpenClickRef.current = null;
      onPeekReturnRef.current?.();
      return;
    }
    if (action === 'toggle' && caps.play_pause) {
      onTogglePlaying();
      playbackPlayPause().catch(noop);
      return;
    }
    if (action === 'raise' && caps.raise) {
      playbackRaise().catch(noop);
      return;
    }
    const now = performance.now();
    const last = lastOpenClickRef.current;
    const isDouble = last !== null
      && now - last.at <= DOUBLE_CLICK_MS
      && Math.hypot(x - last.x, y - last.y) <= DOUBLE_CLICK_SLOP_PX;
    if (isDouble) {
      lastOpenClickRef.current = null;
      onOpenMainRef.current?.();
      openMainWindow().catch(noop);
    } else {
      lastOpenClickRef.current = { at: now, x, y };
    }
  }, [caps.play_pause, caps.raise, onTogglePlaying]);

  const sendResize = useCallback(({ edge, anchorX, width, pointerX }: ResizeDrag, done: boolean) => {
    const pending = (resizeInFlightRef.current ?? Promise.resolve())
      .then(() => resizeMarquee(edge, anchorX, width, pointerX, done))
      .catch(noop);
    resizeInFlightRef.current = pending;
    void pending.then(() => {
      if (resizeInFlightRef.current === pending) resizeInFlightRef.current = null;
    });
    return pending;
  }, []);

  const flushResize = useCallback(function flushResize() {
    const next = pendingResizeRef.current;
    if (!next || resizeInFlightRef.current) return;
    pendingResizeRef.current = null;
    void sendResize(next, false).then(flushResize);
  }, [sendResize]);

  const enqueueDrag = useCallback((step: () => Promise<void>) => {
    const prev = dragChainRef.current;
    const next = prev.then(step).catch(noop);
    dragChainRef.current = next;
    return next;
  }, []);

  const flushMove = useCallback(function flushMove() {
    cancelAnimationFrame(moveRafRef.current);
    moveRafRef.current = 0;
    if (moveInFlightRef.current) return;
    const next = pendingMoveRef.current;
    if (!next) return;
    pendingMoveRef.current = null;
    const pending = enqueueDrag(() => moveMarqueeDrag(next.dx, next.dy));
    moveInFlightRef.current = pending;
    void pending.then(() => {
      if (moveInFlightRef.current === pending) moveInFlightRef.current = null;
      if (pendingMoveRef.current && pressRef.current?.dragBegan) {
        flushMove();
      }
    });
  }, [enqueueDrag]);

  const onPointerDown = useCallback((event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const activeResizeEdge = locked ? null : resizeEdgeFor(event.target, dock);
    const press: Press = {
      pointerId: event.pointerId,
      action: actionFor(event.target),
      resizeEdge: activeResizeEdge,
      startX: event.screenX,
      startY: event.screenY,
      origin: null,
      lastResize: null,
      dragging: false,
      dragBegan: false,
    };
    pressRef.current = press;
    setResizeEdge(activeResizeEdge);
    setTransportPressed(press.action === 'toggle' && activeResizeEdge === null && caps.play_pause);
    if (!locked && activeResizeEdge !== null) {
      const win = getCurrentWindow();
      void (resizeInFlightRef.current ?? Promise.resolve())
        .then(() => Promise.all([win.outerPosition().catch(() => null), win.outerSize(), win.scaleFactor()]))
        .then(([position, size, pixelRatio]) => {
          press.origin = { position, width: size.width, pixelRatio };
        })
        .catch(noop);
    }
  }, [caps.play_pause, dock, locked]);

  const onPointerMove = useCallback((event: PointerEvent<HTMLElement>) => {
    if (!NATIVE_HOVER) {
      const width = event.currentTarget.clientWidth;
      let edge: MarqueeEdge = 0;
      if (!dock.left && event.clientX <= EDGE_ZONE_PX) edge = -1;
      else if (!dock.right && event.clientX >= width - EDGE_ZONE_PX) edge = 1;
      setDomEdge(edge);
    }
    const press = pressRef.current;
    if (!press || press.pointerId !== event.pointerId) return;
    const dx = event.screenX - press.startX;
    const dy = event.screenY - press.startY;
    if (!press.dragging) {
      const distance = press.resizeEdge === null ? Math.hypot(dx, dy) : Math.abs(dx);
      if (locked || distance < DRAG_THRESHOLD_PX) return;
      press.dragging = true;
      onCancelPeekRef.current?.();
      setTransportPressed(false);
      setDragging(true);
      if (press.resizeEdge === null) {
        press.dragBegan = true;
        void enqueueDrag(() => beginMarqueeDrag());
      }
    }
    if (press.resizeEdge !== null) {
      if (!press.origin) return;
      const resize = resizeDragFor(press, event.screenX);
      if (resize) {
        press.lastResize = resize;
        pendingResizeRef.current = resize;
        flushResize();
      }
      return;
    }
    pendingMoveRef.current = { dx, dy };
    moveRafRef.current ||= requestAnimationFrame(flushMove);
  }, [dock.left, dock.right, enqueueDrag, flushMove, flushResize, locked]);

  const endPress = useCallback((event: PointerEvent<HTMLElement>, cancelled: boolean) => {
    const press = pressRef.current;
    if (!press || press.pointerId !== event.pointerId) return;
    pressRef.current = null;
    setTransportPressed(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (press.dragging) {
      setDragging(false);
      if (press.resizeEdge === null) {
        cancelAnimationFrame(moveRafRef.current);
        moveRafRef.current = 0;
        const finalMove = cancelled
          ? null
          : { dx: event.screenX - press.startX, dy: event.screenY - press.startY };
        pendingMoveRef.current = null;
        clearPullVariables(panelRef.current);
        if (press.dragBegan) {
          if (finalMove) {
            void enqueueDrag(() => moveMarqueeDrag(finalMove.dx, finalMove.dy));
          }
          void enqueueDrag(() => endMarqueeDrag());
        }
      } else {
        pendingResizeRef.current = null;
        const finalResize = cancelled ? press.lastResize : resizeDragFor(press, event.screenX);
        if (finalResize) {
          void sendResize(finalResize, true).then(() => {
            if (!pressRef.current) setResizeEdge(null);
          });
        } else {
          setResizeEdge(null);
        }
      }
      return;
    }
    if (press.resizeEdge !== null) {
      setResizeEdge(null);
      return;
    }
    if (!cancelled) runAction(press.action, event.screenX, event.screenY);
  }, [enqueueDrag, panelRef, runAction, sendResize]);

  const onPointerUp = useCallback((event: PointerEvent<HTMLElement>) => endPress(event, false), [endPress]);
  const onPointerCancel = useCallback((event: PointerEvent<HTMLElement>) => endPress(event, true), [endPress]);

  const onWheel = useCallback((event: WheelEvent<HTMLElement>) => {
    const deltaX = event.deltaX;
    const deltaY = normalizeWheelDeltaY(event.deltaY, event.deltaMode);
    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);
    if (absX === 0 && absY === 0) return;

    const swipe = swipeRef.current;
    const peekWheel = peekWheelRef.current;
    const now = performance.now();

    if (absY > absX) {
      if (Math.abs(swipe.accumulated) > 8 || now < swipe.lockedUntil) return;
      peekWheel.lastVerticalAt = now;
      globalThis.clearTimeout(peekWheel.resetTimer);
      const { step, nextAccumulated } = consumePeekWheelStep(peekWheel.accumulated, deltaY);
      peekWheel.accumulated = nextAccumulated;
      peekWheel.resetTimer = globalThis.setTimeout(() => {
        peekWheel.accumulated = 0;
        peekWheel.resetTimer = 0;
      }, PEEK_ACCUM_RESET_MS);
      if (step !== 0) {
        onPeekStepRef.current?.(step);
      }
      return;
    }

    if (now - peekWheel.lastVerticalAt < 160 || Math.abs(peekWheel.accumulated) > 6) return;
    if (now < swipe.lockedUntil) return;
    swipe.accumulated += deltaX;
    globalThis.clearTimeout(swipe.resetTimer);

    const forward = swipe.accumulated > 0;
    const canSkip = forward ? caps.next : caps.previous;
    const progress = Math.min(1, Math.abs(swipe.accumulated) / SWIPE_THRESHOLD_PX);
    if (Math.abs(swipe.accumulated) < SWIPE_THRESHOLD_PX) {
      const offsetPx = (forward ? -1 : 1) * (1 - Math.exp(-progress * 1.8)) * (canSkip ? 10 : 3.5);
      applySwipeFeedback(
        panelRef.current,
        offsetPx,
        canSkip ? progress : progress * 0.35,
        forward ? 'next' : 'previous',
      );
      swipe.resetTimer = globalThis.setTimeout(() => {
        swipe.accumulated = 0;
        swipe.resetTimer = 0;
        clearSwipeFeedback(panelRef.current);
      }, SWIPE_RESET_MS);
      return;
    }

    // Content-follows-finger: swiping left (positive deltaX) moves forward.
    swipe.accumulated = 0;
    swipe.resetTimer = 0;
    swipe.lockedUntil = now + SWIPE_COOLDOWN_MS;
    clearSwipeFeedback(panelRef.current);
    onCancelPeekRef.current?.();
    if (canSkip) {
      onSwipeSkipRef.current?.(forward ? 'next' : 'previous');
      if (forward) playbackNext().catch(noop);
      else playbackPrevious().catch(noop);
    }
  }, [caps.next, caps.previous, panelRef]);

  const onContextMenu = useCallback((event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    lastOpenClickRef.current = null;
    const press = pressRef.current;
    if (press && (press.dragging || press.resizeEdge !== null)) return;
    onContextMenuOpenRef.current?.();
  }, []);

  useEffect(() => {
    const panelEl = panelRef.current;
    const swipe = swipeRef.current;
    const peekWheel = peekWheelRef.current;
    return () => {
      cancelAnimationFrame(moveRafRef.current);
      globalThis.clearTimeout(swipe.resetTimer);
      globalThis.clearTimeout(peekWheel.resetTimer);
      clearSwipeFeedback(panelEl);
      pendingMoveRef.current = null;
      pendingResizeRef.current = null;
      if (pressRef.current?.dragBegan) {
        pressRef.current = null;
        void enqueueDrag(() => endMarqueeDrag());
      }
    };
  }, [enqueueDrag, panelRef]);

  const hovered = NATIVE_HOVER ? nativeHover : domHover;
  const rawEdge = resizeEdge
    ? (resizeEdge === 'left' ? -1 : 1)
    : hovered
      ? (NATIVE_HOVER ? nativeEdge : domEdge)
      : 0;
  const edge: MarqueeEdge = (rawEdge === -1 && dock.left) || (rawEdge === 1 && dock.right) ? 0 : rawEdge;

  return {
    hovered: resizeEdge !== null || (hovered && !dragging),
    /** Side whose resize handle should show; 0 when the pointer is mid-marquee or that edge is attached. */
    edge,
    resizeEdge,
    dragging,
    transportPressed,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onLostPointerCapture: onPointerCancel,
      onWheel,
      onContextMenu,
      onPointerEnter: () => setDomHover(true),
      onPointerLeave: () => {
        setDomHover(false);
        setDomEdge(0);
      },
    },
  };
}
