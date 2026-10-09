import { describe, it, expect } from 'vitest';

import { alphaOf, attach, drawPane, rgbOf, type PaneOptions } from './canvas-recorder.test-utils';
import type { HeatRow } from './oi-heatmap-utils';
import {
  OiProfilePrimitive,
  PROFILE_MAX_BAR_PX,
  PROFILE_MAX_WIDTH_PX,
  PROFILE_MIN_BAR_PX,
  type ProfileOptions,
} from './OiProfilePrimitive';

function row(strike: number, callOi: number, putOi: number, confidence?: number): HeatRow {
  return {
    strike,
    callOi,
    putOi,
    magnitude: callOi + putOi,
    dominant: callOi >= putOi ? 'call' : 'put',
    confidence,
  };
}

function render(rows: HeatRow[], options?: Partial<ProfileOptions>, pane: PaneOptions = {}) {
  const primitive = new OiProfilePrimitive();
  const { requestUpdate } = attach(primitive, pane);
  primitive.update(rows, { side: 'both', colorBy: 'side', rightInsetPx: 0, ...options });
  return { primitive, requestUpdate, ...drawPane(primitive, pane) };
}

const CALL = '0, 233, 151';
const PUT = '203, 56, 85';

describe('OiProfilePrimitive', () => {
  it('anchors bars at the right edge minus the label inset and grows them leftward', () => {
    const { rects } = render([row(100, 50, 0), row(200, 100, 0)], { rightInsetPx: 60 }, { width: 1400 });
    for (const r of rects) expect(r.x + r.width).toBe(1340);
    expect(rects.find((r) => r.y < 150)!.width).toBe(PROFILE_MAX_WIDTH_PX / 2);
    expect(rects.find((r) => r.y > 150)!.width).toBe(PROFILE_MAX_WIDTH_PX);
  });

  it('caps profile width to a fraction of narrow panes', () => {
    const { rects } = render([row(100, 10, 0)], {}, { width: 500 });
    expect(rects[0]!.width).toBe(100);
  });

  it('centers bars on their strike y-coordinate', () => {
    const priceToY = (p: number) => 400 - p / 250;
    const { rects } = render([row(80_000, 1, 0), row(70_000, 1, 0)], {}, { priceToY });
    const centers = rects.map((r) => r.y + r.height / 2).sort((a, b) => a - b);
    expect(centers).toEqual([80, 120]);
  });

  it('stacks call and put segments like a split volume profile', () => {
    const { rects } = render([row(100, 30, 70)], {}, { width: 1200 });
    const [call, put] = rects;
    expect(rgbOf(call!.color)).toBe(CALL);
    expect(rgbOf(put!.color)).toBe(PUT);
    expect(call!.x + call!.width).toBe(1200);
    expect(put!.x + put!.width).toBeCloseTo(call!.x, 6);
    expect(call!.width + put!.width).toBeCloseTo(PROFILE_MAX_WIDTH_PX, 6);
  });

  it('drops the hidden side when Calls or Puts is selected', () => {
    const callsOnly = render([{ ...row(100, 30, 70), magnitude: 30 }], { side: 'calls' });
    expect(callsOnly.rects.map((r) => rgbOf(r.color))).toEqual([CALL]);
    const putsOnly = render([{ ...row(100, 30, 70), magnitude: 70 }], { side: 'puts' });
    expect(putsOnly.rects.map((r) => rgbOf(r.color))).toEqual([PUT]);
  });

  it('colours A4 rows by dominant side with the confidence fade', () => {
    const { rects } = render(
      [{ ...row(100, 10, 0, 1), dominant: 'put' }, { ...row(200, 10, 0, 0), dominant: 'call' }],
      { colorBy: 'gamma' },
    );
    expect(rects).toHaveLength(2);
    expect(rgbOf(rects[0]!.color)).toBe(PUT);
    expect(alphaOf(rects[1]!.color)).toBeCloseTo(alphaOf(rects[0]!.color) * 0.35, 2);
  });

  it('sizes bar thickness from neighbouring strike spacing within bounds', () => {
    const tight = render([row(100, 1, 0), row(105, 1, 0)]);
    expect(tight.rects.every((r) => r.height === 4)).toBe(true);
    const crowded = render([row(100, 1, 0), row(101, 1, 0)]);
    expect(crowded.rects.every((r) => r.height === PROFILE_MIN_BAR_PX)).toBe(true);
    const sparse = render([row(100, 1, 0), row(300, 1, 0)]);
    expect(sparse.rects.every((r) => r.height === PROFILE_MAX_BAR_PX)).toBe(true);
  });

  it('draws in media pixels under a per-axis DPR scale', () => {
    const base = render([row(100, 1, 0)]);
    const hiDpi = render([row(100, 1, 0)], {}, { hpr: 2, vpr: 1.25 });
    expect(hiDpi.scales).toEqual([[2, 1.25]]);
    expect(hiDpi.rects).toEqual(base.rects);
  });

  it('skips strikes without a coordinate or outside the pane', () => {
    const priceToY = (p: number) => (p === 999 ? null : p);
    const { rects } = render([row(-50, 1, 0), row(100, 1, 0), row(999, 1, 0), row(900, 1, 0)], {}, { priceToY, height: 400 });
    expect(rects.map((r) => r.y + r.height / 2)).toEqual([100]);
  });

  it('draws nothing for empty rows or a pane narrower than the inset', () => {
    expect(render([]).rects).toHaveLength(0);
    expect(render([row(100, 1, 0)], { rightInsetPx: 900 }, { width: 800 }).rects).toHaveLength(0);
  });

  it('requests a redraw on update and stops drawing once detached', () => {
    const { primitive, requestUpdate } = render([row(100, 1, 0)]);
    expect(requestUpdate).toHaveBeenCalledTimes(1);
    primitive.detached();
    expect(primitive.paneViews()).toEqual([]);
  });
});
