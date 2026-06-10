import { describe, it, expect } from 'vitest';
import type { Leg } from './payoff';
import {
  buildLadderZones,
  derivePriceDomain,
  legToBlock,
  makePriceScale,
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
});

// makeLeg is reused by later tasks in this file.
export {};
