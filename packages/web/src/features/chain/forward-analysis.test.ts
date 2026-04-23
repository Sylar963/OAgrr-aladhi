import { describe, it, expect } from 'vitest';
import type { EnrichedSide, EnrichedStrike, VenueId, VenueQuote } from '@shared/enriched';
import { computeAtmConsensus, computeImpliedForward } from './forward-analysis';
import { forwardDriftLevel } from '@lib/colors';

function quote(mid: number | null): VenueQuote {
  return {
    bid: null, ask: null, mid, bidSize: null, askSize: null,
    markIv: null, bidIv: null, askIv: null,
    delta: null, gamma: null, theta: null, vega: null,
    spreadPct: null, totalCost: null, estimatedFees: null,
    openInterest: null, volume24h: null, openInterestUsd: null, volume24hUsd: null,
  };
}

function side(venues: Partial<Record<VenueId, number | null>>): EnrichedSide {
  const out: EnrichedSide = { venues: {}, bestIv: null, bestVenue: null };
  for (const [v, mid] of Object.entries(venues)) {
    out.venues[v as VenueId] = quote(mid ?? null);
  }
  return out;
}

function strikeRow(
  strike: number,
  calls: Partial<Record<VenueId, number | null>>,
  puts: Partial<Record<VenueId, number | null>>,
): EnrichedStrike {
  return { strike, call: side(calls), put: side(puts) };
}

describe('computeImpliedForward', () => {
  it('returns strike + call − put', () => {
    expect(computeImpliedForward(78_000, 2_000, 2_080)).toBe(77_920);
  });

  it('returns null when either mid is null', () => {
    expect(computeImpliedForward(78_000, null, 100)).toBeNull();
    expect(computeImpliedForward(78_000, 100, null)).toBeNull();
  });

  it('returns null for non-finite result', () => {
    expect(computeImpliedForward(78_000, Infinity, 100)).toBeNull();
  });
});

describe('computeAtmConsensus', () => {
  const strikes: EnrichedStrike[] = [
    strikeRow(77_000, { deribit: 3_000 }, { deribit: 2_100 }),
    strikeRow(78_000,
      { deribit: 2_000, okx: 1_970, bybit: 2_010, binance: 2_000 },
      { deribit: 2_080, okx: 2_090, bybit: 2_086, binance: 2_082 }),
  ];

  it('returns median of per-venue forwards at ATM', () => {
    const c = computeAtmConsensus(strikes, 78_000, ['deribit', 'okx', 'bybit', 'binance']);
    expect(c).toBe(77_919);
  });

  it('averages two middle values for even counts', () => {
    const c = computeAtmConsensus(strikes, 78_000, ['deribit', 'okx']);
    expect(c).toBeCloseTo((77_920 + 77_880) / 2, 0);
  });

  it('returns null when fewer than 2 venues contribute', () => {
    expect(computeAtmConsensus(strikes, 78_000, ['deribit'])).toBeNull();
  });

  it('returns null when atmStrike is null', () => {
    expect(computeAtmConsensus(strikes, null, ['deribit', 'okx'])).toBeNull();
  });

  it('returns null when ATM strike is not in strikes list', () => {
    expect(computeAtmConsensus(strikes, 99_000, ['deribit', 'okx'])).toBeNull();
  });

  it('respects activeVenues filter', () => {
    const full = computeAtmConsensus(strikes, 78_000, ['deribit', 'okx', 'bybit', 'binance']);
    const subset = computeAtmConsensus(strikes, 78_000, ['deribit', 'okx']);
    expect(subset).not.toBeNull();
    expect(subset).not.toBe(full);
  });
});

describe('forwardDriftLevel', () => {
  it('returns muted for null or non-finite', () => {
    expect(forwardDriftLevel(null)).toBe('muted');
    expect(forwardDriftLevel(Infinity)).toBe('muted');
    expect(forwardDriftLevel(NaN)).toBe('muted');
  });

  it('returns green below 1 bps', () => {
    expect(forwardDriftLevel(0)).toBe('green');
    expect(forwardDriftLevel(0.5)).toBe('green');
    expect(forwardDriftLevel(-0.9)).toBe('green');
  });

  it('returns amber between 1 and 3 bps', () => {
    expect(forwardDriftLevel(1)).toBe('amber');
    expect(forwardDriftLevel(2)).toBe('amber');
    expect(forwardDriftLevel(-2.5)).toBe('amber');
  });

  it('returns red at or above 3 bps', () => {
    expect(forwardDriftLevel(3)).toBe('red');
    expect(forwardDriftLevel(-5)).toBe('red');
    expect(forwardDriftLevel(21.8)).toBe('red');
  });

  it('is magnitude-based, not sign-based', () => {
    expect(forwardDriftLevel(-0.5)).toBe(forwardDriftLevel(0.5));
    expect(forwardDriftLevel(-2)).toBe(forwardDriftLevel(2));
    expect(forwardDriftLevel(-10)).toBe(forwardDriftLevel(10));
  });
});

