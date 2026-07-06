export type LineRef = { start_ms: number; text: string };

export type ScreenEdgeMotion = 'is-leaving-edge';

export type ScreenEdgeMotionMap = Partial<Record<number, ScreenEdgeMotion>>;

export type PaintRange = {
  start: number;
  end: number;
};
