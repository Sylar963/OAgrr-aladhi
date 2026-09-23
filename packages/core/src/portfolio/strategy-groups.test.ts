import { describe, expect, it } from 'vitest';

import type { PositionLeg } from '@oggregator/protocol';

import { detectStrategyGroups } from './strategy-groups.js';

function leg(partial: Partial<PositionLeg> & { legId: string }): PositionLeg {
  return {
    underlying: 'BTC',
    expiry: '2026-06-26',
    strike: 70_000,
    optionRight: 'call',
    size: 1,
    entryPriceUsd: 1_000,
    entryIv: 0.6,
    entryTs: 1_700_000_000_000,
    venueHint: null,
    source: 'manual',
    realizedPnlUsd: 0,
    ...partial,
  };
}

describe('detectStrategyGroups', () => {
  it('returns naked leg when one leg is present', () => {
    const groups = detectStrategyGroups([leg({ legId: 'a' })]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.kind).toBe('naked');
  });

  it('detects a bull put credit spread (short higher, long lower)', () => {
    const legs = [
      leg({
        legId: 'short-80',
        optionRight: 'put',
        strike: 80_000,
        size: -0.31,
        entryPriceUsd: 4_660,
      }),
      leg({
        legId: 'long-78',
        optionRight: 'put',
        strike: 78_000,
        size: 0.31,
        entryPriceUsd: 3_835,
      }),
    ];
    const groups = detectStrategyGroups(legs);
    expect(groups).toHaveLength(1);
    const group = groups[0]!;
    expect(group.kind).toBe('put_spread');
    // net premium = sum(entry * size) = -0.31 * 4660 + 0.31 * 3835 = -255.75
    expect(group.netEntryPremiumUsd).toBeCloseTo(-255.75, 4);
    expect(group.debitOrCredit).toBe('credit');
    // Bull put credit spread max profit = credit, max loss = width - credit.
    expect(group.maxProfitUsd).toBeCloseTo(255.75, 4);
    expect(group.maxLossUsd).toBeCloseTo(0.31 * 2_000 - 255.75, 4);
    expect(group.breakEvenSpotsUsd).toHaveLength(1);
    // Break-even spot for short put spread: short strike - credit/qty
    expect(group.breakEvenSpotsUsd[0]).toBeCloseTo(80_000 - 255.75 / 0.31, 2);
  });

  it('detects a long call debit spread', () => {
    const legs = [
      leg({ legId: 'long-70', strike: 70_000, size: 1, entryPriceUsd: 5_000 }),
      leg({ legId: 'short-80', strike: 80_000, size: -1, entryPriceUsd: 2_000 }),
    ];
    const groups = detectStrategyGroups(legs);
    expect(groups).toHaveLength(1);
    const g = groups[0]!;
    expect(g.kind).toBe('call_spread');
    expect(g.debitOrCredit).toBe('debit');
    expect(g.netEntryPremiumUsd).toBeCloseTo(3_000, 6);
    expect(g.maxProfitUsd).toBeCloseTo(7_000, 6);
    expect(g.maxLossUsd).toBeCloseTo(3_000, 6);
  });

  it('detects a long straddle (same strike, opposite right, same sign size)', () => {
    const legs = [
      leg({ legId: 'call-70', strike: 70_000, size: 1, entryPriceUsd: 4_000 }),
      leg({
        legId: 'put-70',
        strike: 70_000,
        size: 1,
        entryPriceUsd: 3_500,
        optionRight: 'put',
      }),
    ];
    const groups = detectStrategyGroups(legs);
    expect(groups[0]?.kind).toBe('straddle');
    expect(groups[0]?.netEntryPremiumUsd).toBeCloseTo(7_500, 6);
    expect(groups[0]?.debitOrCredit).toBe('debit');
    expect(groups[0]?.breakEvenSpotsUsd).toHaveLength(2);
  });

  it('detects a strangle (different strikes, opposite right, same sign size)', () => {
    const legs = [
      leg({ legId: 'call-80', strike: 80_000, size: 1, entryPriceUsd: 2_000 }),
      leg({
        legId: 'put-60',
        strike: 60_000,
        size: 1,
        entryPriceUsd: 1_500,
        optionRight: 'put',
      }),
    ];
    const groups = detectStrategyGroups(legs);
    expect(groups[0]?.kind).toBe('strangle');
    expect(groups[0]?.maxProfitUsd).toBeNull();
  });

  it('does not group legs across underlyings', () => {
    const legs = [
      leg({ legId: 'a', underlying: 'BTC', strike: 80_000, size: 1, optionRight: 'put' }),
      leg({ legId: 'b', underlying: 'ETH', strike: 4_000, size: -1, optionRight: 'put' }),
    ];
    const groups = detectStrategyGroups(legs);
    expect(groups.every((g) => g.kind === 'naked')).toBe(true);
  });

  it('does not group legs across expiries', () => {
    const legs = [
      leg({ legId: 'a', expiry: '2026-06-26', strike: 80_000, size: 1, optionRight: 'put' }),
      leg({ legId: 'b', expiry: '2026-09-26', strike: 78_000, size: -1, optionRight: 'put' }),
    ];
    const groups = detectStrategyGroups(legs);
    expect(groups.every((g) => g.kind === 'naked')).toBe(true);
  });

  it('pairs unequal sizes at the smaller quantity and leaves the excess as a single leg', () => {
    const legs = [
      leg({ legId: 'long-70', strike: 70_000, size: 2, entryPriceUsd: 1_000 }),
      leg({ legId: 'short-75', strike: 75_000, size: -1, entryPriceUsd: 400 }),
    ];
    const groups = detectStrategyGroups(legs);
    expect(groups.map((g) => g.kind)).toEqual(['call_spread', 'naked']);
    const [spread, naked] = groups;
    expect(spread?.legs.map((l) => l.size)).toEqual([1, -1]);
    expect(spread?.netEntryPremiumUsd).toBeCloseTo(600, 6);
    expect(spread?.maxProfitUsd).toBeCloseTo(5_000 - 600, 6);
    expect(naked?.legIds).toEqual(['long-70']);
    expect(naked?.legs[0]?.size).toBe(1);
    expect(naked?.grossDebitUsd).toBeCloseTo(1_000, 6);
  });

  it('keeps gross premium across groups equal to the whole book', () => {
    const legs = [
      leg({ legId: 'lc', strike: 70_000, size: 3, entryPriceUsd: 1_000 }),
      leg({ legId: 'sc', strike: 75_000, size: -2, entryPriceUsd: 400 }),
      leg({ legId: 'lp', strike: 65_000, optionRight: 'put', size: 0.5, entryPriceUsd: 800 }),
    ];
    const groups = detectStrategyGroups(legs);
    const debit = groups.reduce((acc, g) => acc + g.grossDebitUsd, 0);
    const credit = groups.reduce((acc, g) => acc + g.grossCreditUsd, 0);
    expect(debit).toBeCloseTo(3 * 1_000 + 0.5 * 800, 6);
    expect(credit).toBeCloseTo(2 * 400, 6);
  });
});
