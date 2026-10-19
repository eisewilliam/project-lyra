import { useCallback, useEffect, useRef, useState, type PointerEvent, type WheelEvent } from 'react';
import { listen } from '@tauri-apps/api/event';
import { LogicalSize } from '@tauri-apps/api/dpi';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { ISLAND_MAX_BASE_WIDTH, ISLAND_MIN_BASE_WIDTH } from '@/constants/island-size';
import type { IslandFrame, PlaybackCaps } from '@/types/tauri-contracts';
import { detectHostOs } from '@/utils/os';
import {
  islandPointerInside,
  openMainWindow,
  playbackNext,
  playbackPlayPause,
  playbackPrevious,
  playbackRaise,
  setOverlayPosition,
  settleIslandPosition,
  updateIslandSettings,
} from '@/utils/tauri-commands';

/** What a click does, by the island region pressed (`data-island-action`). */
export type IslandAction = 'open' | 'toggle' | 'raise';

/** A press that moves farther than this is a drag, not a click. */
const DRAG_THRESHOLD_PX = 4;
/** Opening the main window takes a double-click: two clicks this close in
    time and place. A stray single click on the lyrics does nothing. */
const DOUBLE_CLICK_MS = 450;
const DOUBLE_CLICK_SLOP_PX = 6;
/** Horizontal trackpad travel that counts as a swipe to skip. */
const SWIPE_THRESHOLD_PX = 70;
const SWIPE_COOLDOWN_MS = 700;
/** Distance from a side edge (px) that reveals that edge's resize handle. */
const EDGE_ZONE_PX = 20;
/** While hovered, re-check the pointer this often so effects never linger. */
const HOVER_CHECK_MS = 400;

/**
 * On macOS the island is a non-activating panel: WebKit may deliver an enter
 * but never the matching leave while another app is active, which left hover
 * effects stuck on. There, hover and edge proximity come only from the host's
 * native tracking area (`island-hover`, `island-edge`); DOM events are used
 * on the other platforms.
 */
const NATIVE_HOVER = detectHostOs() === 'macos';

export type IslandEdge = -1 | 0 | 1;

const noop = (...args: unknown[]) => { if (args) return; };

type Press = {
  pointerId: number;
  action: IslandAction;
  /** Pressed on an edge handle: resize from that side instead of moving. */
  resizeEdge: -1 | 1 | null;
  startX: number;
  startY: number;
  /** Window frame in physical px and the display's pixels per point, once
      the async lookup returns. */
  origin: { x: number; y: number; width: number; height: number; pixelRatio: number } | null;
  dragging: boolean;
};

function resizeEdgeFor(target: EventTarget | null): -1 | 1 | null {
  const el = target instanceof Element ? target.closest('[data-island-resize]') : null;
  const edge = el?.getAttribute('data-island-resize');
  if (edge === 'left') return -1;
  if (edge === 'right') return 1;
  return null;
}

function actionFor(target: EventTarget | null): IslandAction {
  const el = target instanceof Element ? target.closest('[data-island-action]') : null;
  const action = el?.getAttribute('data-island-action');
  return action === 'toggle' || action === 'raise' ? action : 'open';
}

/**
 * Island pointer model:
 * - hover (native tracking area on macOS, DOM events elsewhere) reveals the
 *   transport control; nearing a side edge reveals that edge's resize handle
 *   (unlocked only);
 * - a click runs the pressed region's action — cover raises the player, the
 *   meter toggles playback; a double-click anywhere else opens the main
 *   window;
 * - a press that travels past a few pixels drags the island instead, unless
 *   its position is locked, and the host settles it where it is let go;
 *   pressing an edge handle resizes it around its centre, within the widths
 *   its size allows on this display;
 * - a horizontal two-finger swipe skips tracks.
 * With click-through on, the window receives no mouse input at all.
 */
export function useIslandInteraction({
  ensureWindowReady,
  frame,
  locked,
  caps,
  onTogglePlaying,
}: {
  ensureWindowReady: () => Promise<void>;
  /** The fitted size; null until the host has sized the window. */
  frame: IslandFrame | null;
  locked: boolean;
  caps: PlaybackCaps;
  onTogglePlaying: () => void;
}) {
  const [nativeHover, setNativeHover] = useState(false);
  const [domHover, setDomHover] = useState(false);
  const [nativeEdge, setNativeEdge] = useState<IslandEdge>(0);
  const [domEdge, setDomEdge] = useState<IslandEdge>(0);
  const [dragging, setDragging] = useState(false);
  const pressRef = useRef<Press | null>(null);
  const moveRafRef = useRef(0);
  const pendingMoveRef = useRef<{ x: number; y: number; width?: number; height?: number } | null>(null);
  const swipeRef = useRef({ accumulated: 0, lockedUntil: 0 });
  const lastOpenClickRef = useRef<{ at: number; x: number; y: number } | null>(null);
  const sizeScale = frame?.scale ?? 1;
  const minWidth = ISLAND_MIN_BASE_WIDTH * sizeScale;
  const maxWidth = Math.max(minWidth, Math.min(ISLAND_MAX_BASE_WIDTH * sizeScale, frame?.max_width ?? Infinity));

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      await ensureWindowReady();
      if (cancelled) return;
      const unlistenHover = await listen<boolean>('island-hover', (event) => {
        setNativeHover(event.payload);
        if (!event.payload) setNativeEdge(0);
      });
      const unlistenEdge = await listen<IslandEdge>('island-edge', (event) => setNativeEdge(event.payload));
      unlisten = () => {
        unlistenHover();
        unlistenEdge();
      };
      if (cancelled) unlisten();
    })().catch(noop);
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [ensureWindowReady]);

  // Safety net for a lost exit event: while hovered, confirm the pointer is
  // still over the island; if not, reverse the hover effects at once.
  useEffect(() => {
    if (!NATIVE_HOVER || !nativeHover) return;
    const timer = globalThis.setInterval(() => {
      islandPointerInside()
        .then((inside) => {
          if (inside) return;
          setNativeHover(false);
          setNativeEdge(0);
        })
        .catch(noop);
    }, HOVER_CHECK_MS);
    return () => globalThis.clearInterval(timer);
  }, [nativeHover]);

  const runAction = useCallback((action: IslandAction, x: number, y: number) => {
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
      openMainWindow().catch(noop);
    } else {
      lastOpenClickRef.current = { at: now, x, y };
    }
  }, [caps.play_pause, caps.raise, onTogglePlaying]);

  const flushMove = useCallback(() => {
    cancelAnimationFrame(moveRafRef.current);
    moveRafRef.current = 0;
    const next = pendingMoveRef.current;
    pendingMoveRef.current = null;
    if (!next) return Promise.resolve();
    if (next.width !== undefined && next.height !== undefined) {
      getCurrentWindow().setSize(new LogicalSize(next.width, next.height)).catch(noop);
    }
    return setOverlayPosition('island', next.x, next.y).catch(noop);
  }, []);

  const onPointerDown = useCallback((event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const press: Press = {
      pointerId: event.pointerId,
      action: actionFor(event.target),
      resizeEdge: locked ? null : resizeEdgeFor(event.target),
      startX: event.screenX,
      startY: event.screenY,
      origin: null,
      dragging: false,
    };
    pressRef.current = press;
    if (!locked) {
      const win = getCurrentWindow();
      Promise.all([win.outerPosition(), win.outerSize(), win.scaleFactor()])
        .then(([position, size, pixelRatio]) => {
          press.origin = { x: position.x, y: position.y, width: size.width, height: size.height, pixelRatio };
        })
        .catch(noop);
    }
  }, [locked]);

  const onPointerMove = useCallback((event: PointerEvent<HTMLElement>) => {
    if (!NATIVE_HOVER) {
      const width = event.currentTarget.clientWidth;
      let edge: IslandEdge = 0;
      if (event.clientX <= EDGE_ZONE_PX) edge = -1;
      else if (event.clientX >= width - EDGE_ZONE_PX) edge = 1;
      setDomEdge(edge);
    }
    const press = pressRef.current;
    if (!press || press.pointerId !== event.pointerId) return;
    const dx = event.screenX - press.startX;
    const dy = event.screenY - press.startY;
    if (!press.dragging) {
      if (locked || Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      press.dragging = true;
      setDragging(true);
    }
    if (!press.origin) return;
    const scale = press.origin.pixelRatio;
    if (press.resizeEdge !== null) {
      // Grow or shrink symmetrically so the island stays centred where it is.
      const startWidth = press.origin.width / scale;
      const width = Math.round(Math.min(maxWidth, Math.max(minWidth, startWidth + 2 * dx * press.resizeEdge)));
      const centerX = press.origin.x + press.origin.width / 2;
      pendingMoveRef.current = {
        x: Math.round(centerX - (width * scale) / 2),
        y: press.origin.y,
        width,
        height: Math.round(press.origin.height / scale),
      };
    } else {
      pendingMoveRef.current = {
        x: Math.round(press.origin.x + dx * scale),
        y: Math.round(press.origin.y + dy * scale),
      };
    }
    moveRafRef.current ||= requestAnimationFrame(flushMove);
  }, [flushMove, locked, maxWidth, minWidth]);

  const endPress = useCallback((event: PointerEvent<HTMLElement>, cancelled: boolean) => {
    const press = pressRef.current;
    if (!press || press.pointerId !== event.pointerId) return;
    pressRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (press.dragging) {
      setDragging(false);
      const origin = press.origin;
      // Apply the last frame of the drag before acting on where it ended.
      const moved = flushMove();
      if (press.resizeEdge === null) {
        // The host settles the island into its display's safe area, lines it
        // up with an edge or the centre when close to one, and saves it.
        void moved.then(() => settleIslandPosition()).catch(noop);
      } else if (origin) {
        // Persist the final width once, not on every frame of the drag, as
        // the width at Medium size so it follows later size changes.
        void moved
          .then(() => getCurrentWindow().innerSize())
          .then((size) => updateIslandSettings({
            base_width: Math.round(size.width / origin.pixelRatio / sizeScale),
          }))
          .catch(noop);
      }
      return;
    }
    if (press.resizeEdge !== null) return;
    if (!cancelled) runAction(press.action, event.screenX, event.screenY);
  }, [flushMove, runAction, sizeScale]);

  const onPointerUp = useCallback((event: PointerEvent<HTMLElement>) => endPress(event, false), [endPress]);
  const onPointerCancel = useCallback((event: PointerEvent<HTMLElement>) => endPress(event, true), [endPress]);

  const onWheel = useCallback((event: WheelEvent<HTMLElement>) => {
    if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
    const swipe = swipeRef.current;
    const now = performance.now();
    if (now < swipe.lockedUntil) return;
    swipe.accumulated += event.deltaX;
    if (Math.abs(swipe.accumulated) < SWIPE_THRESHOLD_PX) return;
    // Content-follows-finger: swiping left (positive deltaX) moves forward.
    const forward = swipe.accumulated > 0;
    swipe.accumulated = 0;
    swipe.lockedUntil = now + SWIPE_COOLDOWN_MS;
    if (forward && caps.next) playbackNext().catch(noop);
    else if (!forward && caps.previous) playbackPrevious().catch(noop);
  }, [caps.next, caps.previous]);

  useEffect(() => () => cancelAnimationFrame(moveRafRef.current), []);

  const hovered = NATIVE_HOVER ? nativeHover : domHover;
  return {
    hovered: hovered && !dragging,
    /** Side whose resize handle should show; 0 when the pointer is mid-island. */
    edge: hovered ? (NATIVE_HOVER ? nativeEdge : domEdge) : 0,
    dragging,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onWheel,
      onPointerEnter: () => setDomHover(true),
      onPointerLeave: () => {
        setDomHover(false);
        setDomEdge(0);
      },
    },
  };
}
