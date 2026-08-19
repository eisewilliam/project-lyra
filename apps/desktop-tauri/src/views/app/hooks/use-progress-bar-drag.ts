import { useCallback, useEffect, useRef, type RefObject } from 'react';
import type { TrackRef } from '@/types/tauri-contracts';
import type { PositionBaseline } from '@/utils/playback-sync';
import { playbackSeekMs } from '@/utils/tauri-commands';
import { formatMs, noop } from '../utils';

export function useProgressBarDrag({
  track,
  setPositionMs,
  baselineRef,
}: {
  track: TrackRef | null;
  setPositionMs: React.Dispatch<React.SetStateAction<number>>;
  baselineRef: RefObject<PositionBaseline>;
}) {
  const dragPositionMsRef = useRef(0);
  const isDraggingRef = useRef(false);
  const progressTrackRef = useRef<HTMLDivElement | null>(null);
  const progressFillRef = useRef<HTMLDivElement | null>(null);
  const positionLabelRef = useRef<HTMLSpanElement | null>(null);

  const trackRef = useRef<TrackRef | null>(null);
  useEffect(() => {
    trackRef.current = track;
  }, [track]);

  const updateDragPosition = useCallback((clientX: number) => {
    const currentTrack = trackRef.current;
    if (!progressTrackRef.current || !currentTrack || currentTrack.duration_ms === 0) return;
    const rect = progressTrackRef.current.getBoundingClientRect();
    const pct = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const targetMs = Math.floor(pct * currentTrack.duration_ms);

    if (progressFillRef.current) {
      progressFillRef.current.style.transform = `scaleX(${pct.toFixed(4)})`;
    }
    if (positionLabelRef.current) {
      positionLabelRef.current.textContent = formatMs(targetMs);
    }
    dragPositionMsRef.current = targetMs;
  }, []);

  const handleMouseMove = useCallback((event: MouseEvent) => {
    updateDragPosition(event.clientX);
  }, [updateDragPosition]);

  const handleMouseUpRef = useRef<() => void>(noop);

  const handleMouseUp = useCallback(() => {
    globalThis.removeEventListener('mousemove', handleMouseMove);
    globalThis.removeEventListener('mouseup', handleMouseUpRef.current);

    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    progressTrackRef.current?.classList.remove('is-dragging');

    const targetMs = dragPositionMsRef.current;
    setPositionMs(targetMs);
    const now = performance.now();
    if (baselineRef.current) {
      baselineRef.current.ms = targetMs;
      baselineRef.current.at = now;
      baselineRef.current.targetMs = targetMs;
      baselineRef.current.targetAt = now;
      baselineRef.current.blendDur = 1;
    }

    playbackSeekMs(targetMs).catch(noop);
  }, [handleMouseMove, setPositionMs, baselineRef]);

  useEffect(() => {
    handleMouseUpRef.current = handleMouseUp;
  }, [handleMouseUp]);

  const handleMouseDown = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const currentTrack = trackRef.current;
    if (!currentTrack || currentTrack.duration_ms === 0) return;
    isDraggingRef.current = true;
    progressTrackRef.current?.classList.add('is-dragging');

    updateDragPosition(event.clientX);

    globalThis.addEventListener('mousemove', handleMouseMove);
    globalThis.addEventListener('mouseup', handleMouseUpRef.current);
  }, [updateDragPosition, handleMouseMove]);

  useEffect(() => {
    return () => {
      globalThis.removeEventListener('mousemove', handleMouseMove);
      globalThis.removeEventListener('mouseup', handleMouseUpRef.current);
    };
  }, [handleMouseMove]);

  return {
    progressTrackRef,
    progressFillRef,
    positionLabelRef,
    handleMouseDown,
    isDragging: isDraggingRef,
  };
}
