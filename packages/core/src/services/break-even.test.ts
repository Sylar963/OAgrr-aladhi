import { describe, expect, it } from 'vitest';
import {
  breakEvenHistory,
  breakEvenLevel,
  historicalExceedance,
  horizonLogReturns,
  impliedExceedance,
  projectBreakEven,
  selectBreakEvenStrikes,
} from './break-even.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe('breakEvenLevel', () => {
  it('adds the call premium and subtracts the put premium', () => {
    const t = 30 / 365;
    const call = breakEvenLevel(64_000, 70_000, 0.4, t, 'call');
    const put = breakEvenLevel(64_000, 60_000, 0.4, t, 'put');
    expect(call).toBeGreaterThan(70_000);
    expect(call).toBeLessThan(71_000);
    expect(put).toBeLessThan(60_000);
    expect(put).toBeGreaterThan(58_000);
  });

  it('collapses to strike plus intrinsic at expiry', () => {
    expect(breakEvenLevel(64_000, 70_000, 0.4, 0, 'call')).toBe(70_000);
    expect(breakEvenLevel(72_000, 70_000, 0.4, 0, 'call')).toBe(72_000);
    expect(breakEvenLevel(64_000, 60_000, 0.4, 0, 'put')).toBe(60_000);
  });
});

describe('impliedExceedance', () => {
  it('is N(d2), below call delta, and calls and puts sum to one', () => {
    const t = 0.25;
    const call = impliedExceedance(64_000, 64_000, 0.5, t, 'call');
    const put = impliedExceedance(64_000, 64_000, 0.5, t, 'put');
    // ATM forward: d2 = −σ√T/2 = −0.125 → N(d2) ≈ 0.4503
    expect(call).toBeCloseTo(0.4503, 3);
    expect(call + put).toBeCloseTo(1, 6);
  });

  it('narrows as IV falls: the 70k call is remote at compressed vol', () => {
    const t = 9 / 365;
    const compressed = impliedExceedance(64_400, 70_000, 0.3, t, 'call');
    const normal = impliedExceedance(64_400, 70_000, 0.6, t, 'call');
    expect(compressed).toBeLessThan(0.05);
    expect(normal).toBeGreaterThan(compressed * 3);
  });
});

describe('selectBreakEvenStrikes', () => {
  const forward = 64_000;
  const candidates = [
    { strike: 66_000, right: 'call' as const, delta: 0.35 },
    { strike: 63_000, right: 'call' as const, delta: 0.6 },
    { strike: 70_000, right: 'call' as const, delta: 0.08 },
    { strike: 90_000, right: 'call' as const, delta: 0.001 },
    { strike: 62_000, right: 'put' as const, delta: -0.3 },
    { strike: 66_000, right: 'put' as const, delta: -0.65 },
  ];

  it('keeps OTM strikes inside the delta band, sorted by strike descending', () => {
    expect(selectBreakEvenStrikes(forward, candidates, 8).map((c) => [c.strike, c.right])).toEqual([
      [70_000, 'call'],
      [66_000, 'call'],
      [62_000, 'put'],
    ]);
  });

  it('thins a crowded side toward target deltas spread from ATM to the wing', () => {
    const crowded = Array.from({ length: 40 }, (_, i) => ({
      strike: 64_000 + i * 1000,
      right: 'call' as const,
      delta: 0.5 * Math.exp(-i / 6),
    }));
    const picked = selectBreakEvenStrikes(forward, crowded, 4);
    expect(picked).toHaveLength(4);
    expect(picked.map((c) => Math.round(c.delta * 100) / 100)).toEqual([0.01, 0.06, 0.3, 0.5]);
  });
});

describe('breakEvenHistory and projectBreakEven', () => {
  const expiryTs = 10 * DAY;

  it('rebuilds break-evens from smiles and skips slots without the strike', () => {
    const smiles = [
      { ts: 0, expiryTs, forward: 64_000, strikes: [70_000], markIvs: [0.4] },
      { ts: HOUR, expiryTs, forward: 64_000, strikes: [68_000], markIvs: [0.4] },
      { ts: 2 * HOUR, expiryTs, forward: 65_000, strikes: [70_000], markIvs: [0.45] },
    ];
    const path = breakEvenHistory(smiles, 70_000, 'call');
    expect(path.map((p) => p.ts)).toEqual([0, 2 * HOUR]);
    expect(path[1]!.value).toBeGreaterThan(path[0]!.value);
  });

  it('decays toward the strike and ends at expiry', () => {
    const from = 5 * DAY + 30 * 60_000;
    const path = projectBreakEven(64_000, 70_000, 0.4, 'call', from, expiryTs, 12 * HOUR);
    expect(path[0]!.ts).toBe(from);
    expect(path[1]!.ts).toBe(5 * DAY + 12 * HOUR);
    expect(path.at(-1)).toEqual({ ts: expiryTs, value: 70_000 });
    for (let i = 1; i < path.length; i++) {
      expect(path[i]!.value).toBeLessThanOrEqual(path[i - 1]!.value);
    }
  });

  it('returns nothing once expired', () => {
    expect(projectBreakEven(64_000, 70_000, 0.4, 'call', expiryTs, expiryTs, HOUR)).toEqual([]);
  });
});

describe('historical exceedance', () => {
  it('returns null with too few windows', () => {
    expect(horizonLogReturns([1, 2, 3], 1)).toBeNull();
  });

  it('removes the sample trend before counting', () => {
    // Steady 1%/day climb: every 5-day move is identical, so after demeaning nothing finishes
    // beyond a strike above the forward.
    const closes = Array.from({ length: 200 }, (_, i) => 100 * 1.01 ** i);
    const returns = horizonLogReturns(closes, 5)!;
    expect(returns.horizonDays).toBe(5);
    expect(historicalExceedance(returns, 100, 101, 'call')).toBe(0);
    expect(historicalExceedance(returns, 100, 99, 'put')).toBe(0);
  });

  it('counts the share of moves beyond the strike on each side', () => {
    const closes: number[] = [];
    let price = 100;
    for (let i = 0; i < 400; i++) {
      price *= i % 2 === 0 ? 1.1 : 1 / 1.1;
      closes.push(price);
    }
    const returns = horizonLogReturns(closes, 1)!;
    // Alternating ±ln(1.1): half the 1-day moves end above +5%, half below −5%.
    expect(historicalExceedance(returns, 100, 105, 'call')).toBeCloseTo(0.5, 2);
    expect(historicalExceedance(returns, 100, 95, 'put')).toBeCloseTo(0.5, 2);
    expect(historicalExceedance(returns, 100, 120, 'call')).toBe(0);
  });
});
