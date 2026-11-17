import { describe, expect, it } from 'vitest';
import { executionToll } from './execution-toll';

describe('executionToll', () => {
  it('separates the one-way midpoint toll from a bid-based percentage', () => {
    const toll = executionToll(2, 2.2)!;
    expect(toll.mid).toBeCloseTo(2.1);
    expect(toll.usd).toBeCloseTo(0.1);
    expect(toll.pct).toBeCloseTo(4.76190476);
    expect(toll.pct * 2).toBeCloseTo(((2.2 - 2) / toll.mid) * 100);
  });

  it('measures the same distance for buying at ask and selling at bid', () => {
    const toll = executionToll(512, 576)!;
    expect(576 - toll.mid).toBe(toll.usd);
    expect(toll.mid - 512).toBe(toll.usd);
    expect(toll.pct).toBeCloseTo(5.88235294);
  });

  it('is independent of quote currency scale', () => {
    expect(executionToll(0.002, 0.0022)!.pct).toBeCloseTo(executionToll(2, 2.2)!.pct);
  });

  it('allows a locked positive market with zero toll', () => {
    expect(executionToll(2, 2)).toEqual({ mid: 2, usd: 0, pct: 0 });
  });

  it.each([
    [null, 2.2],
    [2, null],
    [0, 2.2],
    [2, 0],
    [-2, 2.2],
    [2, -2.2],
    [2.2, 2],
    [Number.NaN, 2.2],
    [2, Number.NaN],
    [Number.POSITIVE_INFINITY, 2.2],
    [2, Number.POSITIVE_INFINITY],
  ])('withholds the toll for invalid quotes (%s, %s)', (bid, ask) => {
    expect(executionToll(bid, ask)).toBeNull();
  });
});
