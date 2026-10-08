import type { PositionLeg } from '@oggregator/protocol';
import { describe, expect, it } from 'vitest';

import { price76 } from '../feeds/thalex/bs-solver.js';
import { type EntryFill, entryAnchorFromFills } from './entry-iv.js';

const entryIvFromFills = (l: PositionLeg, fills: EntryFill[]) => entryAnchorFromFills(l, fills)?.iv ?? null;

const EXPIRY = '2026-10-16';
const EXPIRY_MS = Date.UTC(2026, 9, 16, 8);
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

function leg(size: number, optionRight: 'call' | 'put' = 'put'): PositionLeg {
  return {
    legId: 'thalex|BTC|2026-10-16|82000|put',
    underlying: 'BTC',
    expiry: EXPIRY,
    strike: 82_000,
    optionRight,
    size,
    entryPriceUsd: 900,
    entryIv: null,
    realizedPnlUsd: 0,
    entryTs: 0,
    venueHint: 'thalex',
    source: 'thalex',
  };
}

function fill(
  direction: 'buy' | 'sell',
  amount: number,
  iv: number,
  timestampMs: number,
  spot = 84_000,
): EntryFill {
  const tYears = (EXPIRY_MS - timestampMs) / YEAR_MS;
  return {
    direction,
    amount,
    priceUsd: price76(spot, 82_000, iv, tYears, 'put'),
    timestampMs,
    underlyingPriceUsd: spot,
  };
}

const T1 = Date.UTC(2026, 9, 4, 15);
const T2 = Date.UTC(2026, 9, 7, 3);

describe('entryAnchorFromFills', () => {
  it('recovers the IV a single opening fill was priced at', () => {
    expect(entryIvFromFills(leg(0.04), [fill('buy', 0.04, 0.42, T2)])).toBeCloseTo(0.42, 6);
  });

  it('averages the newest opening lots that make up the open size', () => {
    const fills = [fill('buy', 0.02, 0.5, T1), fill('buy', 0.02, 0.4, T2), fill('buy', 0.02, 0.3, T1 - 1)];
    expect(entryIvFromFills(leg(0.03), fills)).toBeCloseTo((0.02 * 0.4 + 0.01 * 0.5) / 0.03, 6);
  });

  it('uses sells as the opening side of a short', () => {
    const fills = [fill('buy', 0.05, 0.9, T2), fill('sell', 0.05, 0.45, T1)];
    expect(entryIvFromFills(leg(-0.05), fills)).toBeCloseTo(0.45, 6);
  });

  it('anchors spot and time to the same lots as the IV', () => {
    const anchor = entryAnchorFromFills(leg(0.04), [
      fill('buy', 0.01, 0.5, T1, 80_000),
      fill('buy', 0.03, 0.4, T2, 84_000),
    ]);
    expect(anchor?.underlyingUsd).toBeCloseTo(83_000, 6);
    expect(anchor?.timestampMs).toBe(Math.round((0.01 * T1 + 0.03 * T2) / 0.04));
  });

  it('returns null when fill history does not cover the open size', () => {
    expect(entryIvFromFills(leg(0.05), [fill('buy', 0.01, 0.42, T2)])).toBeNull();
    expect(
      entryIvFromFills(leg(0.01), [{ ...fill('buy', 0.01, 0.42, T2), underlyingPriceUsd: null }]),
    ).toBeNull();
  });
});
