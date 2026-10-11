import { describe, expect, it } from 'vitest';

import type { BreakEvenIvRow, PositionLeg } from '@oggregator/protocol';

import { black76Price } from '@lib/analytics/blackScholes';

import {
  buildProfileLegs,
  buildSpotProfile,
  buildVolShockProfile,
  greeks76,
  profileHorizons,
  type ProfileLeg,
} from './greek-profile';

const NOW = Date.parse('2026-10-01T08:00:00.000Z');
const EXPIRY = '2026-10-31';

function leg(overrides: Partial<PositionLeg>): PositionLeg {
  return {
    legId: 'leg',
    underlying: 'BTC',
    expiry: EXPIRY,
    strike: 80_000,
    optionRight: 'call',
    size: 1,
    entryPriceUsd: 1_000,
    entryIv: null,
    realizedPnlUsd: 0,
    entryTs: 0,
    venueHint: null,
    source: 'manual',
    ...overrides,
  } as PositionLeg;
}

function breakEvenRow(legId: string, currentIv: number | null): BreakEvenIvRow {
  return {
    legId,
    strike: 80_000,
    expiry: EXPIRY,
    optionRight: 'call',
    entryIv: null,
    currentMarkUsd: null,
    currentIv,
    breakEvenIv: null,
    ivCushionPct: null,
  };
}

describe('greeks76', () => {
  const F = 82_000;
  const K = 80_000;
  const sigma = 0.45;
  const T = 30 / 365;
  const price = (f: number, s: number, t: number) => black76Price('call', f, K, t, s);

  it('matches finite differences of the Black-76 price in display units', () => {
    const g = greeks76(F, K, sigma, T, 'call');
    const h = 1;
    const dv = 0.0001;

    expect(g.delta).toBeCloseTo((price(F + h, sigma, T) - price(F - h, sigma, T)) / (2 * h), 5);
    expect(g.gamma).toBeCloseTo(
      (price(F + 50, sigma, T) - 2 * price(F, sigma, T) + price(F - 50, sigma, T)) / 2_500,
      7,
    );
    expect(g.vega).toBeCloseTo((price(F, sigma + 0.01, T) - price(F, sigma - 0.01, T)) / 2, 1);
    const tinyT = 1e-6;
    expect(g.theta).toBeCloseTo(
      ((price(F, sigma, T - tinyT) - price(F, sigma, T)) / tinyT) * (1 / 365),
      1,
    );

    const deltaAt = (s: number) => greeks76(F, K, s, T, 'call').delta;
    expect(g.vanna).toBeCloseTo((deltaAt(sigma + dv) - deltaAt(sigma - dv)) / (2 * dv) / 100, 6);
    const vegaAt = (s: number) => greeks76(F, K, s, T, 'call').vega;
    expect(g.volga).toBeCloseTo((vegaAt(sigma + dv) - vegaAt(sigma - dv)) / (2 * dv) / 100, 4);
  });

  it('collapses to intrinsic delta once the option has expired', () => {
    expect(greeks76(90_000, K, sigma, 0, 'call')).toMatchObject({ delta: 1, gamma: 0, vega: 0 });
    expect(greeks76(70_000, K, sigma, 0, 'put').delta).toBe(-1);
    expect(greeks76(90_000, K, sigma, 0, 'put').delta).toBe(0);
  });
});

describe('buildProfileLegs', () => {
  it('prefers live IV, falls back to entry IV, and counts legs it cannot price', () => {
    const positions = [
      leg({ legId: 'live', entryIv: 0.4 }),
      leg({ legId: 'entry', entryIv: 0.5 }),
      leg({ legId: 'none' }),
      leg({ legId: 'other-expiry', expiry: '2026-11-27', entryIv: 0.5 }),
    ];
    const { legs, excluded } = buildProfileLegs(
      positions,
      [breakEvenRow('live', 0.6), breakEvenRow('entry', null)],
      EXPIRY,
    );

    expect(legs.map((profileLeg) => profileLeg.iv)).toEqual([0.6, 0.5]);
    expect(excluded).toBe(1);
  });
});

describe('profileHorizons', () => {
  it('shows now, halfway, and the last day for a monthly expiry', () => {
    expect(profileHorizons(EXPIRY, NOW).map((horizon) => horizon.days)).toEqual([0, 15, 29]);
  });

  it('drops horizons that do not fit before a near expiry', () => {
    expect(profileHorizons('2026-10-04', NOW).map((horizon) => horizon.days)).toEqual([0, 2]);
    expect(profileHorizons('2026-10-02', NOW).map((horizon) => horizon.days)).toEqual([0]);
  });
});

describe('buildSpotProfile', () => {
  const straddle: ProfileLeg[] = [
    { strike: 80_000, expiry: EXPIRY, optionRight: 'call', size: 1, iv: 0.45 },
    { strike: 80_000, expiry: EXPIRY, optionRight: 'put', size: 1, iv: 0.45 },
  ];

  it('samples the strike and spot exactly', () => {
    const { prices } = buildSpotProfile(straddle, 'delta', 81_234, NOW);
    expect(prices).toContain(80_000);
    expect(prices).toContain(81_234);
    expect(prices).toEqual([...prices].sort((left, right) => left - right));
  });

  it('draws long-straddle delta rising through zero near the strike', () => {
    const { prices, series } = buildSpotProfile(straddle, 'delta', 80_000, NOW);
    const now = series[0]!.values;
    expect(now[0]).toBeLessThan(-0.95);
    expect(now[now.length - 1]).toBeGreaterThan(0.95);
    expect(now.every((value, index) => index === 0 || value >= now[index - 1]!)).toBe(true);
    // Forward-neutral straddle delta at the strike is 2N(σ√T/2) − 1, slightly positive.
    expect(now[prices.indexOf(80_000)]!).toBeGreaterThan(0);
    expect(now[prices.indexOf(80_000)]!).toBeLessThan(0.1);
  });

  it('sharpens the gamma peak at the strike as expiry approaches', () => {
    const { prices, series } = buildSpotProfile(straddle, 'gamma', 80_000, NOW);
    const atStrike = prices.indexOf(80_000);
    const peaks = series.map((line) => line.values[atStrike]!);
    expect(peaks[1]!).toBeGreaterThan(peaks[0]!);
    expect(peaks[2]!).toBeGreaterThan(peaks[1]!);
    expect(series[0]!.values[0]!).toBeLessThan(peaks[0]! * 0.5);
  });

  it('flips sign for a short position', () => {
    const short = straddle.map((profileLeg) => ({ ...profileLeg, size: -1 }));
    const longVega = buildSpotProfile(straddle, 'vega', 80_000, NOW).series[0]!.values;
    const shortVega = buildSpotProfile(short, 'vega', 80_000, NOW).series[0]!.values;
    shortVega.forEach((value, index) => expect(value).toBeCloseTo(-longVega[index]!, 9));
  });
});

describe('buildVolShockProfile', () => {
  it('shows positive vol convexity on a long out-of-the-money option', () => {
    const otmCall: ProfileLeg[] = [
      { strike: 100_000, expiry: EXPIRY, optionRight: 'call', size: 1, iv: 0.45 },
    ];
    const { shiftsVolPts, fullPnlUsd, vegaOnlyPnlUsd } = buildVolShockProfile(otmCall, 80_000, NOW);
    const zero = shiftsVolPts.indexOf(0);

    expect(fullPnlUsd[zero]).toBeCloseTo(0, 9);
    expect(vegaOnlyPnlUsd[zero]).toBe(0);
    expect(fullPnlUsd[0]!).toBeGreaterThan(vegaOnlyPnlUsd[0]!);
    expect(fullPnlUsd[fullPnlUsd.length - 1]!).toBeGreaterThan(
      vegaOnlyPnlUsd[vegaOnlyPnlUsd.length - 1]!,
    );
  });

  it('returns nothing without spot', () => {
    expect(buildVolShockProfile([], 80_000, NOW).fullPnlUsd).toEqual([]);
  });
});
