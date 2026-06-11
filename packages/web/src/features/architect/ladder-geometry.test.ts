import { describe, it, expect } from 'vitest';
import type { Leg } from './payoff';
import {
  buildLadderUnits,
  buildLadderZones,
  deriveLadderDomain,
  derivePriceDomain,
  formatPriceTick,
  legToBlock,
  makePriceScale,
  netPnlReadout,
  packLanes,
} from './ladder-geometry';

function makeLeg(over: Partial<Leg> = {}): Leg {
  return {
    id: 'leg-1',
    type: 'call',
    direction: 'buy',
    strike: 100,
    expiry: '2026-12-25',
    quantity: 1,
    entryPrice: 3,
    venue: 'deribit',
    delta: 0.5,
    gamma: 0.01,
    theta: -0.1,
    vega: 0.2,
    iv: 0.5,
    ...over,
  };
}

describe('makePriceScale', () => {
  it('maps priceMax to padTop and priceMin to padTop+plotH (price runs up)', () => {
    const s = makePriceScale(90, 110, 20, 200);
    expect(s.y(110)).toBeCloseTo(20);
    expect(s.y(90)).toBeCloseTo(220);
    expect(s.y(100)).toBeCloseTo(120);
  });

  it('priceAt is the inverse of y', () => {
    const s = makePriceScale(90, 110, 20, 200);
    expect(s.priceAt(20)).toBeCloseTo(110);
    expect(s.priceAt(220)).toBeCloseTo(90);
    expect(s.priceAt(s.y(103.7))).toBeCloseTo(103.7);
  });

  it('does not divide by zero when domain is degenerate', () => {
    const s = makePriceScale(100, 100, 20, 200);
    expect(Number.isFinite(s.y(100))).toBe(true);
    expect(s.y(100)).toBeCloseTo(20);
  });
});

describe('derivePriceDomain', () => {
  it('uses the payoff points range when present', () => {
    const d = derivePriceDomain(
      [
        { underlyingPrice: 80, pnl: -3 },
        { underlyingPrice: 130, pnl: 27 },
      ],
      100,
    );
    expect(d.priceMin).toBe(80);
    expect(d.priceMax).toBe(130);
  });

  it('falls back to a spot-relative window when there are no points', () => {
    const d = derivePriceDomain([], 100);
    expect(d.priceMin).toBeCloseTo(90);
    expect(d.priceMax).toBeCloseTo(110);
  });

  it('never returns a negative priceMin', () => {
    const d = derivePriceDomain([], 0.5);
    expect(d.priceMin).toBeGreaterThanOrEqual(0);
  });
});

describe('deriveLadderDomain', () => {
  const strikes = [80, 90, 95, 100, 105, 110, 120];

  it('zooms far tighter than the wide payoff-curve range (de-compresses blocks)', () => {
    const block = legToBlock(makeLeg({ type: 'call', direction: 'buy', strike: 100, entryPrice: 3 }));
    const d = deriveLadderDomain([block], [103], 100, strikes);
    // A long call's block [100,103] must be a healthy fraction of the domain,
    // not a sliver inside a ±30% spot window (which would be ~[70,130]).
    expect(d.priceMax - d.priceMin).toBeLessThan(40);
    expect(d.priceMin).toBeLessThanOrEqual(100);
    expect(d.priceMax).toBeGreaterThanOrEqual(103);
  });

  it('spans both break-evens of a straddle and keeps spot inside', () => {
    const call = legToBlock(makeLeg({ id: 'c', type: 'call', direction: 'buy', strike: 100, entryPrice: 3 }));
    const put = legToBlock(makeLeg({ id: 'p', type: 'put', direction: 'buy', strike: 100, entryPrice: 3 }));
    const d = deriveLadderDomain([call, put], [94, 106], 100, strikes);
    expect(d.priceMin).toBeLessThan(94);
    expect(d.priceMax).toBeGreaterThan(106);
  });

  it('returns nearby strikes as rungs and excludes far ones', () => {
    const block = legToBlock(makeLeg({ type: 'call', direction: 'buy', strike: 100, entryPrice: 3 }));
    const d = deriveLadderDomain([block], [103], 100, strikes);
    expect(d.rungs).toContain(100);
    expect(d.rungs).toContain(105);
    expect(d.rungs).not.toContain(120);
  });

  it('falls back to a spot window with no legs but still surfaces nearby rungs', () => {
    const d = deriveLadderDomain([], [], 100, strikes);
    expect(d.priceMin).toBeLessThan(100);
    expect(d.priceMax).toBeGreaterThan(100);
    expect(d.rungs).toContain(100);
  });

  it('caps rung count for dense chains, keeping the ones nearest spot', () => {
    const dense = Array.from({ length: 200 }, (_, i) => 100 + i); // 100..299
    const block = legToBlock(makeLeg({ type: 'call', direction: 'buy', strike: 100, entryPrice: 3 }));
    const d = deriveLadderDomain([block], [103], 100, dense, 10);
    expect(d.rungs.length).toBeLessThanOrEqual(10);
    expect(d.rungs).toContain(100);
  });

  it('sub-$1 underlying stays tight and positive', () => {
    const block = legToBlock(makeLeg({ type: 'call', direction: 'buy', strike: 0.5, entryPrice: 0.02 }));
    const d = deriveLadderDomain([block], [0.52], 0.5, [0.45, 0.5, 0.55]);
    expect(d.priceMin).toBeGreaterThanOrEqual(0);
    expect(d.priceMax - d.priceMin).toBeLessThan(0.5);
  });
});

describe('legToBlock', () => {
  it('long call: block spans strike → strike+premium, far edge above', () => {
    const b = legToBlock(makeLeg({ type: 'call', direction: 'buy', strike: 100, entryPrice: 3, quantity: 1 }));
    expect(b.legBreakeven).toBeCloseTo(103);
    expect(b.spanLowPrice).toBeCloseTo(100);
    expect(b.spanHighPrice).toBeCloseTo(103);
    expect(b.label).toBe('+1 C 100');
  });

  it('long put: block spans strike-premium → strike, far edge below', () => {
    const b = legToBlock(makeLeg({ type: 'put', direction: 'buy', strike: 100, entryPrice: 3 }));
    expect(b.legBreakeven).toBeCloseTo(97);
    expect(b.spanLowPrice).toBeCloseTo(97);
    expect(b.spanHighPrice).toBeCloseTo(100);
  });

  it('short call: same span as long call but sell direction + minus label', () => {
    const b = legToBlock(makeLeg({ type: 'call', direction: 'sell', strike: 100, entryPrice: 3, quantity: 2 }));
    expect(b.spanLowPrice).toBeCloseTo(100);
    expect(b.spanHighPrice).toBeCloseTo(103);
    expect(b.direction).toBe('sell');
    expect(b.label).toBe('−2 C 100');
  });

  it('short put: spans strike-premium → strike, sell direction + minus label', () => {
    const b = legToBlock(makeLeg({ type: 'put', direction: 'sell', strike: 100, entryPrice: 3, quantity: 1 }));
    expect(b.label).toBe('−1 P 100');
    expect(b.spanLowPrice).toBeCloseTo(97);
    expect(b.spanHighPrice).toBeCloseTo(100);
    expect(b.legBreakeven).toBeCloseTo(97);
  });

  it('sub-$1 underlying keeps full precision (no rounding to strike)', () => {
    const b = legToBlock(makeLeg({ type: 'call', direction: 'buy', strike: 0.5, entryPrice: 0.02 }));
    expect(b.legBreakeven).toBeCloseTo(0.52);
    expect(b.spanHighPrice).toBeCloseTo(0.52);
    expect(b.spanLowPrice).toBeCloseTo(0.5);
  });
});

describe('buildLadderZones', () => {
  it('returns [] for no legs', () => {
    expect(buildLadderZones([], [], 100)).toEqual([]);
  });

  it('long call → loss below break-even, profit above', () => {
    const legs = [makeLeg({ id: 'leg-1', type: 'call', direction: 'buy', strike: 100, entryPrice: 3 })];
    const zones = buildLadderZones(legs, [103], 100);
    expect(zones).toHaveLength(2);
    expect(zones[0]).toMatchObject({ lowPrice: -Infinity, highPrice: 103, profit: false });
    expect(zones[1]).toMatchObject({ lowPrice: 103, highPrice: Infinity, profit: true });
  });

  it('long straddle → red band between break-evens, green outside (the hero case)', () => {
    const legs = [
      makeLeg({ id: 'leg-1', type: 'call', direction: 'buy', strike: 100, entryPrice: 3 }),
      makeLeg({ id: 'leg-2', type: 'put', direction: 'buy', strike: 100, entryPrice: 3 }),
    ];
    const zones = buildLadderZones(legs, [94, 106], 100);
    expect(zones.map((z) => z.profit)).toEqual([true, false, true]);
    expect(zones[1]).toMatchObject({ lowPrice: 94, highPrice: 106, profit: false });
  });

  it('no break-evens → single zone signed by spot P&L', () => {
    const legs = [makeLeg({ id: 'leg-1', type: 'call', direction: 'sell', strike: 200, entryPrice: 5 })];
    const zones = buildLadderZones(legs, [], 100);
    expect(zones).toHaveLength(1);
    expect(zones[0]).toMatchObject({ lowPrice: -Infinity, highPrice: Infinity, profit: true });
  });

  it('bull call spread (one short leg) → loss below break-even, profit above', () => {
    const legs = [
      makeLeg({ id: 'leg-1', type: 'call', direction: 'buy', strike: 100, entryPrice: 4 }),
      makeLeg({ id: 'leg-2', type: 'call', direction: 'sell', strike: 110, entryPrice: 1.5 }),
    ];
    const zones = buildLadderZones(legs, [102.5], 100);
    expect(zones).toHaveLength(2);
    expect(zones.map((z) => z.profit)).toEqual([false, true]);
  });
});

describe('packLanes', () => {
  it('straddle: touching call/put blocks share one lane (they tile)', () => {
    const blocks = [
      legToBlock(makeLeg({ id: 'leg-1', type: 'call', direction: 'buy', strike: 100, entryPrice: 3 })), // [100,103]
      legToBlock(makeLeg({ id: 'leg-2', type: 'put', direction: 'buy', strike: 100, entryPrice: 3 })), // [97,100]
    ];
    const lanes = packLanes(blocks);
    expect(lanes.get('leg-1')).toBe(0);
    expect(lanes.get('leg-2')).toBe(0);
  });

  it('overlapping same-strike blocks split into separate lanes', () => {
    const blocks = [
      legToBlock(makeLeg({ id: 'leg-1', type: 'call', direction: 'buy', strike: 100, entryPrice: 5 })), // [100,105]
      legToBlock(makeLeg({ id: 'leg-2', type: 'call', direction: 'sell', strike: 100, entryPrice: 5 })), // [100,105]
    ];
    const lanes = packLanes(blocks);
    const used = new Set([lanes.get('leg-1'), lanes.get('leg-2')]);
    expect(used.size).toBe(2);
  });
});

describe('buildLadderUnits', () => {
  it('fuses a bull call spread into one spread unit (long lower, short higher)', () => {
    const units = buildLadderUnits([
      makeLeg({ id: 'long', type: 'call', direction: 'buy', strike: 100, entryPrice: 4 }),
      makeLeg({ id: 'short', type: 'call', direction: 'sell', strike: 110, entryPrice: 1.5 }),
    ]);
    expect(units).toHaveLength(1);
    const u = units[0]!;
    if (u.kind !== 'spread') throw new Error('expected a spread unit');
    expect(u.spread.longLegId).toBe('long');
    expect(u.spread.shortLegId).toBe('short');
    expect(u.spread.lowStrike).toBe(100);
    expect(u.spread.highStrike).toBe(110);
    expect(u.spread.label).toBe('C 100/110');
  });

  it('handles a bear call spread (short lower, long higher) — corridor still 100/110', () => {
    const units = buildLadderUnits([
      makeLeg({ id: 'short', type: 'call', direction: 'sell', strike: 100, entryPrice: 4 }),
      makeLeg({ id: 'long', type: 'call', direction: 'buy', strike: 110, entryPrice: 1.5 }),
    ]);
    expect(units).toHaveLength(1);
    const u = units[0]!;
    if (u.kind !== 'spread') throw new Error('expected a spread unit');
    expect(u.spread.longStrike).toBe(110);
    expect(u.spread.shortStrike).toBe(100);
  });

  it('splits an iron condor into two spreads and no singles', () => {
    const units = buildLadderUnits([
      makeLeg({ id: 'lp', type: 'put', direction: 'buy', strike: 90, entryPrice: 1 }),
      makeLeg({ id: 'sp', type: 'put', direction: 'sell', strike: 95, entryPrice: 2 }),
      makeLeg({ id: 'sc', type: 'call', direction: 'sell', strike: 105, entryPrice: 2 }),
      makeLeg({ id: 'lc', type: 'call', direction: 'buy', strike: 110, entryPrice: 1 }),
    ]);
    expect(units.filter((u) => u.kind === 'spread')).toHaveLength(2);
    expect(units.filter((u) => u.kind === 'single')).toHaveLength(0);
  });

  it('does NOT fuse a straddle (same direction → no pair)', () => {
    const units = buildLadderUnits([
      makeLeg({ id: 'c', type: 'call', direction: 'buy', strike: 100 }),
      makeLeg({ id: 'p', type: 'put', direction: 'buy', strike: 100 }),
    ]);
    expect(units.every((u) => u.kind === 'single')).toBe(true);
    expect(units).toHaveLength(2);
  });

  it('does NOT fuse a calendar (different expiry) or a ratio (different qty)', () => {
    const calendar = buildLadderUnits([
      makeLeg({ id: 'a', type: 'call', direction: 'buy', strike: 100, expiry: '2026-09-25' }),
      makeLeg({ id: 'b', type: 'call', direction: 'sell', strike: 100, expiry: '2026-12-25' }),
    ]);
    expect(calendar.every((u) => u.kind === 'single')).toBe(true);
    const ratio = buildLadderUnits([
      makeLeg({ id: 'a', type: 'call', direction: 'buy', strike: 100, quantity: 1 }),
      makeLeg({ id: 'b', type: 'call', direction: 'sell', strike: 110, quantity: 2 }),
    ]);
    expect(ratio.every((u) => u.kind === 'single')).toBe(true);
  });

  it('leaves a naked short call as a single block', () => {
    const units = buildLadderUnits([
      makeLeg({ id: 'sc', type: 'call', direction: 'sell', strike: 100 }),
    ]);
    expect(units).toEqual([
      expect.objectContaining({ kind: 'single' }),
    ]);
  });
});

describe('netPnlReadout', () => {
  it('long call: ~0 at break-even, positive above', () => {
    const legs = [makeLeg({ id: 'leg-1', type: 'call', direction: 'buy', strike: 100, entryPrice: 3 })];
    expect(netPnlReadout(legs, 103, -3).pnl).toBeCloseTo(0);
    expect(netPnlReadout(legs, 110, -3).pnl).toBeGreaterThan(0);
  });

  it('pct is null when there is no cost basis', () => {
    const legs = [makeLeg({ id: 'leg-1' })];
    expect(netPnlReadout(legs, 100, 0).pct).toBeNull();
  });
});

describe('formatPriceTick', () => {
  it('uses k-format above 1000 and decimals scaled to span', () => {
    expect(formatPriceTick(64000, 4000, 66000)).toBe('64.0k');
    expect(formatPriceTick(100, 40, 120)).toBe('100');
    expect(formatPriceTick(0.52, 0.3, 0.7)).toBe('0.520'); // V1 pickDecimals: span 0.3 → 3 dp
  });

  it('decides k-format from the axis max so ticks straddling 1000 stay consistent', () => {
    // Same axis (max 1200): both sides of 1000 must use one format (V1-faithful).
    expect(formatPriceTick(950, 400, 1200)).toBe('0.950k');
    expect(formatPriceTick(1150, 400, 1200)).toBe('1.150k');
  });
});
