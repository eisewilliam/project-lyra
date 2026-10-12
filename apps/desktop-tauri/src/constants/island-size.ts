/**
 * Marquee size constants, mirrored from `island_size.rs` (the host fits the
 * window; these let the frontend draw previews and limit drag resizing).
 * Lengths are in points.
 */

export const ISLAND_SCALE_STEPS = [
  { value: 0.85, label: 'Small' },
  { value: 1, label: 'Medium' },
  { value: 1.2, label: 'Large' },
  { value: 1.4, label: 'Extra large' },
] as const;

export const ISLAND_MIN_BASE_WIDTH = 360;
export const ISLAND_MAX_BASE_WIDTH = 900;

/** Base design height for one or two lines, at Medium size. */
export function islandBaseHeight(lines: number): number {
  return lines <= 1 ? 56 : 72;
}

export function islandScaleLabel(scale: number): string {
  const nearest = ISLAND_SCALE_STEPS.reduce((best, step) => (
    Math.abs(step.value - scale) < Math.abs(best.value - scale) ? step : best
  ));
  return nearest.label;
}
