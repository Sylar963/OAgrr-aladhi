import { describe, it, expect } from 'vitest';

import {
  BlockBubblePrimitive,
  bubbleCoreAlpha,
  bubbleRadiusPx,
  bubbleScaleRef,
  MAX_BUBBLE_RADIUS_PX,
  MIN_BUBBLE_RADIUS_PX,
} from './BlockBubblePrimitive';
import { alphaOf, attach, drawPane, rgbOf, type PaneOptions } from './canvas-recorder.test-utils';
import type { BlockBubble } from './oi-bubble-utils';

function bubble(timeSec: number, strike: number, value: number, dominant: 'call' | 'put' = 'call'): BlockBubble {
  return {
    timeSec,
    strike,
    value,
    callValue: dominant === 'call' ? value : 0,
    putValue: dominant === 'put' ? value : 0,
    dominant,
    legs: 1,
  };
}

function render(bubbles: BlockBubble[], opts: PaneOptions = {}) {
  const primitive = new BlockBubblePrimitive();
  const { requestUpdate } = attach(primitive, opts);
  primitive.update(bubbles);
  return { primitive, requestUpdate, ...drawPane(primitive, opts) };
}

describe('bubble scale', () => {
  it('bounds the radius and grows it on a square-root scale', () => {
    expect(bubbleRadiusPx(0, 100)).toBe(MIN_BUBBLE_RADIUS_PX);
    expect(bubbleRadiusPx(100, 100)).toBe(MAX_BUBBLE_RADIUS_PX);
    expect(bubbleRadiusPx(1e9, 100)).toBe(MAX_BUBBLE_RADIUS_PX);
    const grown = (v: number) => bubbleRadiusPx(v, 100) - MIN_BUBBLE_RADIUS_PX;
    expect(grown(100) / grown(25)).toBeCloseTo(2, 6);
    expect(bubbleRadiusPx(5, 0)).toBe(MIN_BUBBLE_RADIUS_PX);
  });

  it('references a high percentile so one outlier does not flatten the rest', () => {
    const values = Array.from({ length: 100 }, (_, i) => bubble(i, 1, i + 1));
    values.push(bubble(999, 1, 1_000_000));
    expect(bubbleScaleRef(values)).toBe(99);
    expect(bubbleScaleRef([])).toBe(0);
  });

  it('fades small bubbles more than large ones', () => {
    expect(bubbleCoreAlpha(1, 100)).toBeLessThan(bubbleCoreAlpha(100, 100));
  });
});

describe('BlockBubblePrimitive rendering', () => {
  it('centers each bubble on its candle time and strike price', () => {
    const timeToX = (t: number) => t / 10;
    const priceToY = (p: number) => 400 - p / 250;
    const { arcs } = render([bubble(3000, 80_000, 10), bubble(5000, 75_000, 10)], { timeToX, priceToY });
    expect(arcs.map((a) => [a.x, a.y])).toEqual([[300, 80], [500, 100]]);
    for (const a of arcs) {
      expect(a.gradient).toMatchObject({ x0: a.x, y0: a.y, r0: 0, x1: a.x, y1: a.y, r1: a.radius });
    }
  });

  it('sizes bubbles by traded value, clamping at the percentile reference', () => {
    const { arcs } = render([bubble(100, 100, 1), bubble(200, 100, 50), bubble(300, 100, 100)]);
    expect(arcs[0]!.radius).toBeLessThan(arcs[1]!.radius);
    expect(arcs[1]!.radius).toBe(MAX_BUBBLE_RADIUS_PX);
    expect(arcs[2]!.radius).toBe(MAX_BUBBLE_RADIUS_PX);
  });

  it('fades each gradient to transparent in its own side colour', () => {
    const { arcs } = render([bubble(100, 100, 10, 'call'), bubble(200, 200, 10, 'put')]);
    for (const a of arcs) {
      const alphas = a.stops.map((s) => alphaOf(s.color));
      for (let i = 1; i < alphas.length; i++) expect(alphas[i]).toBeLessThan(alphas[i - 1]!);
      expect(a.stops[a.stops.length - 1]).toMatchObject({ offset: 1 });
      expect(alphas[alphas.length - 1]).toBe(0);
      expect(new Set(a.stops.map((s) => rgbOf(s.color))).size).toBe(1);
    }
    expect(rgbOf(arcs[0]!.stops[0]!.color)).toBe('0, 233, 151');
    expect(rgbOf(arcs[1]!.stops[0]!.color)).toBe('203, 56, 85');
  });

  it('draws in media pixels under a per-axis DPR scale', () => {
    const base = render([bubble(100, 100, 10)]);
    const hiDpi = render([bubble(100, 100, 10)], { hpr: 2, vpr: 1.5 });
    expect(hiDpi.scales).toEqual([[2, 1.5]]);
    expect(hiDpi.arcs[0]).toMatchObject({ x: base.arcs[0]!.x, y: base.arcs[0]!.y, radius: base.arcs[0]!.radius });
  });

  it('skips bubbles without a candle, strike coordinate, or outside the pane', () => {
    const timeToX = (t: number) => (t === 7 ? null : t);
    const priceToY = (p: number) => (p === 9 ? null : p);
    const { arcs } = render(
      [bubble(7, 100, 1), bubble(100, 9, 1), bubble(-100, 100, 1), bubble(900, 100, 1), bubble(100, 600, 1), bubble(100, 100, 1)],
      { timeToX, priceToY, width: 800, height: 400 },
    );
    expect(arcs.map((a) => [a.x, a.y])).toEqual([[100, 100]]);
  });

  it('draws nothing and touches no canvas state for empty data', () => {
    const { arcs, ctx } = render([]);
    expect(arcs).toHaveLength(0);
    expect(ctx.save).not.toHaveBeenCalled();
  });

  it('finds the largest bubble under the cursor for the hovered candle', () => {
    const { primitive } = render([bubble(100, 200, 1), bubble(100, 205, 100), bubble(300, 200, 100)]);
    expect(primitive.bubbleAt(100, 203)?.strike).toBe(205);
    expect(primitive.bubbleAt(100, 260)).toBeNull();
    expect(primitive.bubbleAt(500, 200)).toBeNull();
  });

  it('requests a redraw on update and stops drawing once detached', () => {
    const { primitive, requestUpdate } = render([bubble(100, 100, 1)]);
    expect(requestUpdate).toHaveBeenCalledTimes(1);
    primitive.detached();
    expect(primitive.paneViews()).toEqual([]);
    expect(primitive.bubbleAt(100, 100)).toBeNull();
  });
});
