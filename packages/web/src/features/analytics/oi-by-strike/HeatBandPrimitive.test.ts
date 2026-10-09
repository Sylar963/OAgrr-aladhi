import { describe, it, expect, vi } from 'vitest';
import type { IPrimitivePaneRenderer, SeriesAttachedParameter, Time } from 'lightweight-charts';

import {
  HeatBandPrimitive,
  bubbleRadiusPx,
  BUBBLE_EDGE_INSET_PX,
  MAX_BUBBLE_RADIUS_PX,
  MIN_BUBBLE_RADIUS_PX,
} from './HeatBandPrimitive';
import type { HeatRow } from './oi-heatmap-utils';

interface Bubble {
  x: number;
  y: number;
  radius: number;
  gradient: { x0: number; y0: number; r0: number; x1: number; y1: number; r1: number };
  stops: { offset: number; color: string }[];
}

function fakeContext() {
  const bubbles: Bubble[] = [];
  const scales: [number, number][] = [];
  let pending: Omit<Bubble, 'x' | 'y' | 'radius'> | null = null;
  let path: { x: number; y: number; radius: number } | null = null;
  const ctx = {
    fillStyle: '' as unknown,
    save: vi.fn(),
    restore: vi.fn(),
    scale: (sx: number, sy: number) => { scales.push([sx, sy]); },
    fillRect: vi.fn(),
    beginPath: () => { path = null; },
    arc: (x: number, y: number, radius: number) => { path = { x, y, radius }; },
    createRadialGradient: (x0: number, y0: number, r0: number, x1: number, y1: number, r1: number) => {
      const g = { x0, y0, r0, x1, y1, r1 };
      const stops: { offset: number; color: string }[] = [];
      pending = { gradient: g, stops };
      return { addColorStop: (offset: number, color: string) => { stops.push({ offset, color }); } };
    },
    fill: () => {
      if (path && pending) bubbles.push({ ...path, ...pending });
    },
  };
  return { ctx, bubbles, scales };
}

function row(strike: number, magnitude: number, dominant: 'call' | 'put' = 'call', confidence?: number): HeatRow {
  return { strike, callOi: 0, putOi: 0, magnitude, dominant, confidence };
}

function render(
  rows: HeatRow[],
  opts: { width?: number; height?: number; hpr?: number; vpr?: number; priceToY?: (p: number) => number | null } = {},
) {
  const { width = 800, height = 400, hpr = 1, vpr = 1 } = opts;
  const priceToY = opts.priceToY ?? ((p: number) => p);
  const primitive = new HeatBandPrimitive();
  const requestUpdate = vi.fn();
  primitive.attached({
    series: { priceToCoordinate: priceToY },
    requestUpdate,
  } as unknown as SeriesAttachedParameter<Time>);
  primitive.update(rows);

  const { ctx, bubbles, scales } = fakeContext();
  const renderer = primitive.paneViews()[0]!.renderer() as IPrimitivePaneRenderer;
  renderer.draw({
    useBitmapCoordinateSpace: (f: (scope: unknown) => unknown) => f({
      context: ctx,
      bitmapSize: { width: width * hpr, height: height * vpr },
      horizontalPixelRatio: hpr,
      verticalPixelRatio: vpr,
    }),
  } as never);
  return { bubbles, scales, ctx, requestUpdate };
}

function alphaOf(color: string): number {
  return Number(color.match(/,\s*([0-9.]+)\)$/)![1]);
}

function rgbOf(color: string): string {
  return color.match(/^rgba\((\d+,\s*\d+,\s*\d+)/)![1]!;
}

describe('bubbleRadiusPx', () => {
  it('bounds radius between min and max', () => {
    expect(bubbleRadiusPx(0, 100)).toBe(MIN_BUBBLE_RADIUS_PX);
    expect(bubbleRadiusPx(100, 100)).toBe(MAX_BUBBLE_RADIUS_PX);
    expect(bubbleRadiusPx(500, 100)).toBe(MAX_BUBBLE_RADIUS_PX);
  });

  it('uses a square-root scale so area tracks magnitude', () => {
    const span = MAX_BUBBLE_RADIUS_PX - MIN_BUBBLE_RADIUS_PX;
    expect(bubbleRadiusPx(25, 100)).toBeCloseTo(MIN_BUBBLE_RADIUS_PX + 0.5 * span, 6);
    const grown = (m: number) => bubbleRadiusPx(m, 100) - MIN_BUBBLE_RADIUS_PX;
    expect(grown(100) / grown(25)).toBeCloseTo(2, 6);
  });

  it('falls back to the minimum radius for a non-positive max', () => {
    expect(bubbleRadiusPx(10, 0)).toBe(MIN_BUBBLE_RADIUS_PX);
  });
});

describe('HeatBandPrimitive bubble rendering', () => {
  it('draws one bubble per row on a shared column near the right edge', () => {
    const { bubbles, ctx } = render([row(100, 10), row(200, 40), row(300, 100)], { width: 800 });
    expect(bubbles).toHaveLength(3);
    const expectedX = 800 - BUBBLE_EDGE_INSET_PX - MAX_BUBBLE_RADIUS_PX;
    for (const b of bubbles) {
      expect(b.x).toBe(expectedX);
      expect(b.x + b.radius).toBeLessThanOrEqual(800 - BUBBLE_EDGE_INSET_PX);
    }
    expect(ctx.fillRect).not.toHaveBeenCalled();
  });

  it('centers each bubble at its strike y-coordinate', () => {
    const priceToY = (p: number) => 400 - p / 10;
    const { bubbles } = render([row(1000, 10), row(2500, 10)], { priceToY });
    expect(bubbles.map((b) => b.y)).toEqual([300, 150]);
    for (const b of bubbles) {
      expect(b.gradient).toMatchObject({ x0: b.x, y0: b.y, r0: 0, x1: b.x, y1: b.y, r1: b.radius });
    }
  });

  it('sizes bubbles by magnitude relative to the largest row', () => {
    const { bubbles } = render([row(100, 25), row(200, 100)]);
    expect(bubbles[0]!.radius).toBeCloseTo(bubbleRadiusPx(25, 100), 6);
    expect(bubbles[1]!.radius).toBe(MAX_BUBBLE_RADIUS_PX);
  });

  it('fades the gradient to transparent in the same hue', () => {
    const { bubbles } = render([row(100, 100, 'call'), row(200, 50, 'put')]);
    for (const b of bubbles) {
      const offsets = b.stops.map((s) => s.offset);
      expect(offsets[0]).toBe(0);
      expect(offsets[offsets.length - 1]).toBe(1);
      const alphas = b.stops.map((s) => alphaOf(s.color));
      for (let i = 1; i < alphas.length; i++) expect(alphas[i]).toBeLessThan(alphas[i - 1]!);
      expect(alphas[alphas.length - 1]).toBe(0);
      expect(new Set(b.stops.map((s) => rgbOf(s.color))).size).toBe(1);
    }
    expect(rgbOf(bubbles[0]!.stops[0]!.color)).toBe('0, 233, 151');
    expect(rgbOf(bubbles[1]!.stops[0]!.color)).toBe('203, 56, 85');
  });

  it('preserves the A4 confidence fade', () => {
    const { bubbles } = render([row(100, 100, 'call', 1), row(200, 100, 'call', 0)]);
    const confident = alphaOf(bubbles[0]!.stops[0]!.color);
    const naive = alphaOf(bubbles[1]!.stops[0]!.color);
    expect(naive).toBeCloseTo(confident * 0.35, 2);
  });

  it('scales horizontal and vertical axes independently on high-DPI displays', () => {
    const base = render([row(100, 100)], { width: 800, height: 400 });
    const hiDpi = render([row(100, 100)], { width: 800, height: 400, hpr: 2, vpr: 1.5 });
    expect(hiDpi.scales).toEqual([[2, 1.5]]);
    expect(hiDpi.bubbles[0]).toMatchObject({
      x: base.bubbles[0]!.x,
      y: base.bubbles[0]!.y,
      radius: base.bubbles[0]!.radius,
    });
  });

  it('skips strikes without a coordinate or outside the pane', () => {
    const priceToY = (p: number) => (p === 999 ? null : p);
    const { bubbles } = render([row(-50, 10), row(100, 10), row(999, 10), row(900, 10)], {
      height: 400,
      priceToY,
    });
    expect(bubbles.map((b) => b.y)).toEqual([100]);
  });

  it('keeps a bubble whose edge still overlaps the pane', () => {
    const { bubbles } = render([row(-5, 100)], { height: 400 });
    expect(bubbles).toHaveLength(1);
  });

  it('draws nothing for empty rows', () => {
    const { bubbles, ctx } = render([]);
    expect(bubbles).toHaveLength(0);
    expect(ctx.save).not.toHaveBeenCalled();
  });

  it('draws nothing when the pane is too narrow for a bubble', () => {
    const { bubbles } = render([row(100, 10)], { width: 20 });
    expect(bubbles).toHaveLength(0);
  });

  it('restores the canvas state after drawing', () => {
    const { ctx } = render([row(100, 10)]);
    expect(ctx.save).toHaveBeenCalledTimes(1);
    expect(ctx.restore).toHaveBeenCalledTimes(1);
  });

  it('requests a redraw on update and stops drawing once detached', () => {
    const primitive = new HeatBandPrimitive();
    const requestUpdate = vi.fn();
    primitive.attached({
      series: { priceToCoordinate: (p: number) => p },
      requestUpdate,
    } as unknown as SeriesAttachedParameter<Time>);
    primitive.update([row(100, 10)]);
    expect(requestUpdate).toHaveBeenCalledTimes(1);
    primitive.detached();
    expect(primitive.paneViews()).toEqual([]);
  });
});
