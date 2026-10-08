import type { PositionLeg } from '@oggregator/protocol';
import { describe, expect, it } from 'vitest';

import { price76 } from '../feeds/thalex/bs-solver.js';
import { computePnlAttribution } from './pnl-attribution.js';
import type { MarkContext } from './types.js';

const EXPIRY = '2026-11-27';
const EXPIRY_MS = Date.UTC(2026, 10, 27, 8);
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const ENTRY_TS = Date.UTC(2026, 9, 1, 12);
const NOW_TS = Date.UTC(2026, 9, 8, 12);
const T_ENTRY = (EXPIRY_MS - ENTRY_TS) / YEAR_MS;
const T_NOW = (EXPIRY_MS - NOW_TS) / YEAR_MS;

function leg(overrides: Partial<PositionLeg> = {}): PositionLeg {
  return {
    legId: 'derive|BTC|2026-11-27|110000|call',
    underlying: 'BTC',
    expiry: EXPIRY,
    strike: 110_000,
    optionRight: 'call',
    size: -0.5,
    entryPriceUsd: price76(100_000, 110_000, 0.5, T_ENTRY, 'call'),
    entryIv: 0.5,
    entryUnderlyingUsd: 100_000,
    realizedPnlUsd: 0,
    entryTs: ENTRY_TS,
    venueHint: 'derive',
    source: 'derive',
    ...overrides,
  };
}

function mark(markPriceUsd: number): MarkContext {
  return {
    underlyingPriceUsd: 104_000,
    forwardPriceUsd: 104_000,
    markPriceUsd,
    iv: 0.45,
    delta: null,
    gamma: null,
    vega: null,
    theta: null,
    yearsToExpiry: T_NOW,
  };
}

describe('computePnlAttribution', () => {
  it('splits open P&L into spot, time and vol that sum back to the total', () => {
    const modelNow = price76(104_000, 110_000, 0.45, T_NOW, 'call');
    const l = leg();
    const result = computePnlAttribution([{ leg: l, mark: mark(modelNow) }])!;

    const spot = (price76(104_000, 110_000, 0.5, T_ENTRY, 'call') - l.entryPriceUsd) * l.size;
    const time =
      (price76(104_000, 110_000, 0.5, T_NOW, 'call') - price76(104_000, 110_000, 0.5, T_ENTRY, 'call')) *
      l.size;
    expect(result.spotUsd).toBeCloseTo(spot, 6);
    expect(result.timeUsd).toBeCloseTo(time, 6);
    expect(result.spotUsd).toBeLessThan(0);
    expect(result.timeUsd).toBeGreaterThan(0);
    expect(result.volUsd).toBeGreaterThan(0);
    expect(result.otherUsd).toBeCloseTo(0, 6);
    expect(result.spotUsd + result.timeUsd + result.volUsd + result.otherUsd).toBeCloseTo(
      result.openPnlUsd,
      6,
    );
  });

  it('puts the gap between the venue mark and the model in other', () => {
    const modelNow = price76(104_000, 110_000, 0.45, T_NOW, 'call');
    const result = computePnlAttribution([{ leg: leg(), mark: mark(modelNow + 20) }])!;
    expect(result.otherUsd).toBeCloseTo(20 * -0.5, 6);
  });

  it('reports legs without an entry anchor as unattributed', () => {
    const result = computePnlAttribution([
      { leg: leg({ entryUnderlyingUsd: null, entryPriceUsd: 1_000 }), mark: mark(1_200) },
    ])!;
    expect(result.unattributedUsd).toBeCloseTo(-100, 6);
    expect(result.attributedLegs).toBe(0);
    expect(result.totalLegs).toBe(1);
  });
});
