import { describe, expect, it } from 'vitest';

import type { Leg } from '@features/architect';
import {
  chanceOfProfit,
  decodeDraft,
  describeLeg,
  encodeDraft,
  profitZones,
} from './easy-explain';

function leg(partial: Partial<Leg>): Leg {
  return {
    id: 'l',
    type: 'call',
    direction: 'buy',
    strike: 100,
    expiry: '2026-10-17',
    quantity: 1,
    entryPrice: 5,
    venue: 'deribit',
    delta: null,
    gamma: null,
    theta: null,
    vega: null,
    iv: null,
    ...partial,
  };
}

describe('drag payload', () => {
  it('round-trips a draft', () => {
    const draft = { type: 'put', direction: 'sell', strike: 81_500 } as const;
    expect(decodeDraft(encodeDraft(draft))).toEqual(draft);
  });

  it('rejects malformed payloads', () => {
    expect(decodeDraft('not json')).toBeNull();
    expect(decodeDraft(JSON.stringify({ type: 'call', direction: 'buy', strike: -1 }))).toBeNull();
    expect(decodeDraft(JSON.stringify({ type: 'straddle', direction: 'buy', strike: 1 }))).toBeNull();
  });
});

describe('profitZones', () => {
  it('marks only the band above the breakeven as profit for a long call', () => {
    const zones = profitZones([leg({})], [105], 100);
    expect(zones).toEqual([
      { low: -Infinity, high: 105, profit: false },
      { low: 105, high: Infinity, profit: true },
    ]);
  });

  it('marks the inner band as profit for a short strangle', () => {
    const legs = [
      leg({ type: 'put', direction: 'sell', strike: 90, entryPrice: 2 }),
      leg({ type: 'call', direction: 'sell', strike: 110, entryPrice: 2 }),
    ];
    const zones = profitZones(legs, [86, 114], 100);
    expect(zones.map((z) => z.profit)).toEqual([false, true, false]);
  });
});

describe('chanceOfProfit', () => {
  it('is about 50% for an at-the-forward breakeven with negligible vol drag', () => {
    const zones = profitZones([leg({ strike: 95, entryPrice: 5 })], [100], 100);
    const p = chanceOfProfit(zones, 100, 0.01, 1 / 365);
    expect(p).not.toBeNull();
    expect(p!).toBeCloseTo(0.5, 2);
  });

  it('returns null without a usable IV', () => {
    const zones = profitZones([leg({})], [105], 100);
    expect(chanceOfProfit(zones, 100, null, 0.1)).toBeNull();
  });

  it('sums the two tails of a long straddle', () => {
    const legs = [leg({ type: 'call' }), leg({ type: 'put' })];
    const zones = profitZones(legs, [90, 110], 100);
    const p = chanceOfProfit(zones, 100, 0.5, 30 / 365)!;
    const callTail = chanceOfProfit([{ low: 110, high: Infinity, profit: true }], 100, 0.5, 30 / 365)!;
    const putTail = chanceOfProfit([{ low: -Infinity, high: 90, profit: true }], 100, 0.5, 30 / 365)!;
    expect(p).toBeCloseTo(callTail + putTail, 10);
  });
});

describe('describeLeg', () => {
  it('states the cost and payout trigger of a bought call', () => {
    const text = describeLeg(leg({ strike: 82_000, entryPrice: 230 }), 'BTC', 'en');
    expect(text).toContain('You pay $230');
    expect(text).toContain('above $82,000');
    expect(text).toContain('$82,230');
  });

  it('states the credit and loss trigger of a sold put', () => {
    const text = describeLeg(leg({ type: 'put', direction: 'sell', strike: 80_000, entryPrice: 100 }), 'BTC', 'en');
    expect(text).toContain('You collect $100');
    expect(text).toContain('below $79,900');
  });
});
