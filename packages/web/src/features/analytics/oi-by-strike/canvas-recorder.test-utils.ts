import { vi } from 'vitest';
import type { IPrimitivePaneRenderer, ISeriesPrimitive, SeriesAttachedParameter, Time } from 'lightweight-charts';

export interface RecordedArc {
  x: number;
  y: number;
  radius: number;
  gradient: { x0: number; y0: number; r0: number; x1: number; y1: number; r1: number };
  stops: { offset: number; color: string }[];
}

export interface RecordedRect {
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
}

export function recordingContext() {
  const arcs: RecordedArc[] = [];
  const rects: RecordedRect[] = [];
  const scales: [number, number][] = [];
  let gradient: Omit<RecordedArc, 'x' | 'y' | 'radius'> | null = null;
  let path: { x: number; y: number; radius: number } | null = null;
  const ctx = {
    fillStyle: '' as unknown,
    save: vi.fn(),
    restore: vi.fn(),
    scale: (sx: number, sy: number) => { scales.push([sx, sy]); },
    beginPath: () => { path = null; },
    arc: (x: number, y: number, radius: number) => { path = { x, y, radius }; },
    createRadialGradient: (x0: number, y0: number, r0: number, x1: number, y1: number, r1: number) => {
      const stops: { offset: number; color: string }[] = [];
      gradient = { gradient: { x0, y0, r0, x1, y1, r1 }, stops };
      return { addColorStop: (offset: number, color: string) => { stops.push({ offset, color }); } };
    },
    fill: () => {
      if (path && gradient) arcs.push({ ...path, ...gradient });
    },
    fillRect(x: number, y: number, width: number, height: number) {
      rects.push({ x, y, width, height, color: String(this.fillStyle) });
    },
  };
  return { ctx, arcs, rects, scales };
}

export interface PaneOptions {
  width?: number;
  height?: number;
  hpr?: number;
  vpr?: number;
  priceToY?: (price: number) => number | null;
  timeToX?: (time: number) => number | null;
}

export function attach(primitive: ISeriesPrimitive<Time>, opts: PaneOptions = {}) {
  const priceToY = opts.priceToY ?? ((p: number) => p);
  const timeToX = opts.timeToX ?? ((t: number) => t);
  const requestUpdate = vi.fn();
  primitive.attached?.({
    series: { priceToCoordinate: priceToY },
    chart: { timeScale: () => ({ timeToCoordinate: timeToX }) },
    requestUpdate,
  } as unknown as SeriesAttachedParameter<Time>);
  return { requestUpdate };
}

export function drawPane(primitive: ISeriesPrimitive<Time>, opts: PaneOptions = {}) {
  const { width = 800, height = 400, hpr = 1, vpr = 1 } = opts;
  const recorder = recordingContext();
  const views = primitive.paneViews?.() ?? [];
  for (const view of views) {
    const renderer = view.renderer() as IPrimitivePaneRenderer | null;
    renderer?.draw({
      useBitmapCoordinateSpace: (f: (scope: unknown) => unknown) => f({
        context: recorder.ctx,
        bitmapSize: { width: width * hpr, height: height * vpr },
        horizontalPixelRatio: hpr,
        verticalPixelRatio: vpr,
      }),
    } as never);
  }
  return recorder;
}

export function alphaOf(color: string): number {
  return Number(color.match(/,\s*([0-9.]+)\)$/)![1]);
}

export function rgbOf(color: string): string {
  return color.match(/^rgba\((\d+,\s*\d+,\s*\d+)/)![1]!;
}
