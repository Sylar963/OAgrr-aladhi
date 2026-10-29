import type { PositionLeg, StrategyGroup, StrategyGroupLeg } from '@oggregator/protocol';
import { describe, expect, it } from 'vitest';

import { candleIndexAt, strategyEntries } from './entry-markers';
import { strategyBias } from './strategy-label';

const T0 = Date.parse('2026-10-20T10:00:00Z');

function position(overrides: Partial<PositionLeg>): PositionLeg {
  return {
    legId: 'leg',
    underlying: 'BTC',
    expiry: '2026-11-06',
    strike: 80_000,
    optionRight: 'call',
    size: 1,
    entryPriceUsd: 1_000,
    entryIv: null,
    realizedPnlUsd: 0,
    entryTs: T0,
    venueHint: 'thalex',
    source: 'thalex',
    ...overrides,
  } as PositionLeg;
}

function group(kind: StrategyGroup['kind'], legs: StrategyGroupLeg[], underlying = 'BTC'): StrategyGroup {
  const net = legs.reduce((acc, l) => acc + l.entryPriceUsd * l.size, 0);
  return {
    groupId: `${kind}:${legs.map((l) => l.legId).join('+')}`,
    kind,
    underlying,
    expiry: '2026-11-06',
    legIds: legs.map((l) => l.legId),
    legs,
    netEntryPremiumUsd: net,
    debitOrCredit: net > 0 ? 'debit' : 'credit',
    maxProfitUsd: null,
    maxLossUsd: null,
    breakEvenSpotsUsd: [],
    grossDebitUsd: 0,
    grossCreditUsd: 0,
    totals: {
      netDeltaCoin: 0,
      optionsDeltaCoin: 0,
      linearDeltaCoin: 0,
      netGammaUsd: 0,
      netVegaUsd: 0,
      netThetaUsd: 0,
      netVannaUsd: 0,
      netVolgaUsd: 0,
      unrealizedPnlUsd: 0,
    },
  };
}

const leg = (legId: string, strike: number, optionRight: 'call' | 'put', size: number): StrategyGroupLeg => ({
  legId,
  strike,
  optionRight,
  size,
  entryPriceUsd: 500,
});

describe('strategyBias', () => {
  it('reads direction from naked legs and verticals', () => {
    expect(strategyBias(group('naked', [leg('a', 80_000, 'call', 1)]))).toBe('bull');
    expect(strategyBias(group('naked', [leg('a', 80_000, 'call', -1)]))).toBe('bear');
    expect(strategyBias(group('naked', [leg('a', 80_000, 'put', 1)]))).toBe('bear');
    expect(strategyBias(group('naked', [leg('a', 80_000, 'put', -1)]))).toBe('bull');
    expect(strategyBias(group('call_spread', [leg('a', 80_000, 'call', 1), leg('b', 85_000, 'call', -1)]))).toBe('bull');
    expect(strategyBias(group('call_spread', [leg('a', 80_000, 'call', -1), leg('b', 85_000, 'call', 1)]))).toBe('bear');
    expect(strategyBias(group('put_spread', [leg('a', 75_000, 'put', -1), leg('b', 80_000, 'put', 1)]))).toBe('bear');
    expect(strategyBias(group('put_spread', [leg('a', 75_000, 'put', 1), leg('b', 80_000, 'put', -1)]))).toBe('bull');
  });

  it('reads vol side from straddles, strangles and iron structures', () => {
    expect(strategyBias(group('strangle', [leg('a', 75_000, 'put', -1), leg('b', 85_000, 'call', -1)]))).toBe('short_vol');
    expect(strategyBias(group('straddle', [leg('a', 80_000, 'put', 1), leg('b', 80_000, 'call', 1)]))).toBe('long_vol');
    const condor = [
      leg('a', 70_000, 'put', 1),
      leg('b', 75_000, 'put', -1),
      leg('c', 85_000, 'call', -1),
      leg('d', 90_000, 'call', 1),
    ];
    expect(strategyBias(group('iron_condor', condor))).toBe('short_vol');
    expect(strategyBias(group('iron_condor', condor.map((l) => ({ ...l, size: -l.size }))))).toBe('long_vol');
    const itmFly = [
      leg('a', 79_500, 'call', 1),
      leg('b', 80_500, 'call', -1),
      leg('c', 80_500, 'put', -1),
      leg('d', 81_500, 'put', 1),
    ];
    expect(strategyBias(group('iron_butterfly', itmFly))).toBe('short_vol');
  });
});

describe('strategyEntries', () => {
  it('emits one entry per structure, anchored at the last leg fill', () => {
    const strangle = group('strangle', [leg('p', 75_000, 'put', -1), leg('c', 85_000, 'call', -1)]);
    const positions = [
      position({ legId: 'p', entryTs: T0, entryUnderlyingUsd: 80_100 }),
      position({ legId: 'c', entryTs: T0 + 3 * 3_600_000, entryUnderlyingUsd: 80_900 }),
    ];

    const [entry, ...rest] = strategyEntries([strangle], positions, 'BTC');

    expect(rest).toHaveLength(0);
    expect(entry).toMatchObject({
      bias: 'short_vol',
      openedAtMs: T0 + 3 * 3_600_000,
      spotUsd: 80_900,
      leggedOverMs: 3 * 3_600_000,
    });
  });

  it('skips other underlyings and structures whose legs are gone', () => {
    const eth = group('naked', [leg('e', 2_000, 'call', 1)], 'ETH');
    const orphan = group('naked', [leg('missing', 80_000, 'call', 1)]);
    expect(strategyEntries([eth, orphan], [position({ legId: 'e', underlying: 'ETH' })], 'BTC')).toEqual([]);
  });

  it('leaves spot null when the leg has no fill anchor', () => {
    const naked = group('naked', [leg('a', 80_000, 'call', 1)]);
    expect(strategyEntries([naked], [position({ legId: 'a' })], 'BTC')[0]?.spotUsd).toBeNull();
  });
});

describe('candleIndexAt', () => {
  const candles = [1_000, 2_000, 3_000];

  it('finds the candle containing the timestamp', () => {
    expect(candleIndexAt(candles, 999)).toBe(-1);
    expect(candleIndexAt(candles, 1_000)).toBe(0);
    expect(candleIndexAt(candles, 2_999)).toBe(1);
    expect(candleIndexAt(candles, 9_999)).toBe(2);
  });
});
