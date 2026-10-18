import { describe, expect, it } from 'vitest';
import type { DealerPosition } from './dealer-book.js';
import { computeGex, type EnrichedStrike, type VenueQuote } from './enrichment.js';
import { combineGexProfile, computeGexProfile, GEX_PROFILE_MOVES } from './gex-profile.js';
import type { ComparisonRow, NormalizedOptionContract } from './types.js';

const SPOT = 80_000;
const NOW = Date.UTC(2026, 9, 18);
const EXPIRY = NOW + 30 * 86_400_000;
const T = 30 / 365;

function bsGamma(s: number, k: number, iv: number, t: number): number {
  const v = iv * Math.sqrt(t);
  const d1 = (Math.log(s / k) + 0.5 * v * v) / v;
  return Math.exp(-0.5 * d1 * d1) / Math.sqrt(2 * Math.PI) / (s * v);
}

function contract(strike: number, right: 'call' | 'put'): NormalizedOptionContract {
  return {
    venue: 'deribit',
    symbol: `${right}-${strike}`,
    exchangeSymbol: `${right}-${strike}`,
    base: 'BTC',
    settle: 'BTC',
    expiry: '2026-11-17',
    expiryTs: EXPIRY,
    strike,
    right,
    inverse: true,
    contractSize: 1,
    tickSize: null,
    minQty: null,
    makerFee: null,
    takerFee: null,
    greeks: {
      delta: null,
      gamma: null,
      theta: null,
      vega: null,
      rho: null,
      markIv: null,
      bidIv: null,
      askIv: null,
    },
    quote: {
      bid: { raw: null, rawCurrency: 'BTC', usd: null },
      ask: { raw: null, rawCurrency: 'BTC', usd: null },
      mark: { raw: null, rawCurrency: 'BTC', usd: null },
      last: null,
      bidSize: null,
      askSize: null,
      underlyingPriceUsd: SPOT,
      indexPriceUsd: SPOT,
      volume24h: null,
      openInterest: null,
      openInterestUsd: null,
      volume24hUsd: null,
      estimatedFees: null,
      timestamp: 1,
      source: 'ws',
    },
  };
}

function quote(strike: number, oi: number, iv: number): VenueQuote {
  return {
    bid: null,
    ask: null,
    mid: null,
    midRaw: null,
    bidSize: null,
    askSize: null,
    markIv: iv,
    bidIv: null,
    askIv: null,
    delta: null,
    gamma: bsGamma(SPOT, strike, iv, T),
    theta: null,
    vega: null,
    spreadPct: null,
    totalCost: null,
    estimatedFees: null,
    openInterest: oi,
    volume24h: null,
    openInterestUsd: null,
    volume24hUsd: null,
  };
}

// Put OI below spot, call OI above: the naive prior makes dealers short gamma
// low and long gamma high, so total GEX must cross zero somewhere in between.
const LEGS: Array<{ strike: number; right: 'call' | 'put'; oi: number; iv: number }> = [
  { strike: 70_000, right: 'put', oi: 900, iv: 0.55 },
  { strike: 75_000, right: 'put', oi: 600, iv: 0.5 },
  { strike: 85_000, right: 'call', oi: 500, iv: 0.45 },
  { strike: 90_000, right: 'call', oi: 800, iv: 0.47 },
];

function fixture(): { rows: ComparisonRow[]; strikes: EnrichedStrike[] } {
  const rows: ComparisonRow[] = [];
  const strikes: EnrichedStrike[] = [];
  for (const leg of LEGS) {
    const empty = { bestIv: null, bestVenue: null, venues: {} };
    const side = { bestIv: leg.iv, bestVenue: 'deribit' as const, venues: { deribit: quote(leg.strike, leg.oi, leg.iv) } };
    rows.push({
      strike: leg.strike,
      call: leg.right === 'call' ? { deribit: contract(leg.strike, 'call') } : {},
      put: leg.right === 'put' ? { deribit: contract(leg.strike, 'put') } : {},
    });
    strikes.push({
      strike: leg.strike,
      call: leg.right === 'call' ? side : empty,
      put: leg.right === 'put' ? side : empty,
    });
  }
  return { rows, strikes };
}

describe('computeGexProfile', () => {
  it('matches the venue-gamma GEX total at the 0% point', () => {
    const { rows, strikes } = fixture();
    const total = computeGex(rows, strikes, SPOT).reduce((sum, g) => sum + g.gexUsdMillions, 0);
    const profile = computeGexProfile(rows, strikes, SPOT, EXPIRY, undefined, NOW);
    expect(profile).toHaveLength(GEX_PROFILE_MOVES.length);
    expect(profile.find((p) => p.movePct === 0)!.gexUsdMillions).toBeCloseTo(total, 9);
  });

  it('turns negative as spot falls into the short-gamma put strikes', () => {
    const { rows, strikes } = fixture();
    const profile = computeGexProfile(rows, strikes, SPOT, EXPIRY, undefined, NOW);
    const at = (m: number) => profile.find((p) => Math.abs(p.movePct - m) < 1e-9)!.gexUsdMillions;
    expect(at(-0.1)).toBeLessThan(0);
    expect(at(0.1)).toBeGreaterThan(0);
  });

  it('signs each contract from the dealer book when one exists', () => {
    const { rows, strikes } = fixture();
    const flipped = (venue: string, symbol: string): DealerPosition | undefined => {
      const leg = LEGS.find((l) => `${l.right}-${l.strike}` === symbol);
      if (!leg || venue !== 'deribit') return undefined;
      return {
        venue: 'deribit',
        symbol,
        underlying: 'BTC',
        expiry: '2026-11-17',
        strike: leg.strike,
        optionType: leg.right,
        dealerContracts: leg.right === 'call' ? -leg.oi : leg.oi,
        flowContracts: leg.oi,
        lastOi: leg.oi,
        lastSnapshotTs: NOW,
      };
    };
    const naive = computeGexProfile(rows, strikes, SPOT, EXPIRY, undefined, NOW);
    const book = computeGexProfile(rows, strikes, SPOT, EXPIRY, flipped, NOW);
    for (let i = 0; i < naive.length; i++) {
      expect(book[i]!.gexUsdMillions).toBeCloseTo(-naive[i]!.gexUsdMillions, 9);
    }
  });

  it('anchors each curve to the venue gamma at spot when asked', () => {
    const { rows, strikes } = fixture();
    for (const s of strikes) {
      for (const q of Object.values({ ...s.call.venues, ...s.put.venues })) {
        if (q?.gamma != null) q.gamma *= 1.2;
      }
    }
    const venueTotal = computeGex(rows, strikes, SPOT).reduce((sum, g) => sum + g.gexUsdMillions, 0);
    const plain = computeGexProfile(rows, strikes, SPOT, EXPIRY, undefined, NOW);
    const anchored = computeGexProfile(rows, strikes, SPOT, EXPIRY, undefined, NOW, {
      anchorToVenueGamma: true,
    });
    const at0 = (p: typeof plain) => p.find((x) => x.movePct === 0)!.gexUsdMillions;
    expect(at0(plain)).not.toBeCloseTo(venueTotal, 3);
    expect(at0(anchored)).toBeCloseTo(venueTotal, 9);
  });

  it('skips quotes without a mark IV', () => {
    const { rows, strikes } = fixture();
    for (const s of strikes) {
      for (const q of Object.values({ ...s.call.venues, ...s.put.venues })) {
        if (q) q.markIv = null;
      }
    }
    const profile = computeGexProfile(rows, strikes, SPOT, EXPIRY, undefined, NOW);
    expect(profile.every((p) => p.gexUsdMillions === 0)).toBe(true);
  });
});

describe('computeGex with an expiry', () => {
  it('re-prices gamma from mark IV instead of trusting rounded venue greeks', () => {
    const { rows, strikes } = fixture();
    const exact = computeGex(rows, strikes, SPOT);
    // Deribit sends gamma rounded to 5 decimals: OTM BTC strikes read 1e-5 or 0.
    for (const s of strikes) {
      for (const q of Object.values({ ...s.call.venues, ...s.put.venues })) {
        if (q?.gamma != null) q.gamma = Math.round(q.gamma * 1e5) / 1e5;
      }
    }
    const rounded = computeGex(rows, strikes, SPOT);
    const repriced = computeGex(rows, strikes, SPOT, undefined, EXPIRY, NOW);
    expect(rounded.some((g, i) => Math.abs(g.gexUsdMillions / exact[i]!.gexUsdMillions - 1) > 0.1)).toBe(true);
    repriced.forEach((g, i) => expect(g.gexUsdMillions).toBeCloseTo(exact[i]!.gexUsdMillions, 9));
  });

  it('falls back to the venue gamma when a quote has no mark IV', () => {
    const { rows, strikes } = fixture();
    for (const s of strikes) {
      for (const q of Object.values({ ...s.call.venues, ...s.put.venues })) {
        if (q) q.markIv = null;
      }
    }
    const withExpiry = computeGex(rows, strikes, SPOT, undefined, EXPIRY, NOW);
    const venueOnly = computeGex(rows, strikes, SPOT);
    expect(withExpiry).toEqual(venueOnly);
  });
});

describe('combineGexProfile', () => {
  it('sums profiles pointwise in move order', () => {
    expect(
      combineGexProfile([
        [
          { movePct: 0.005, gexUsdMillions: 1 },
          { movePct: 0, gexUsdMillions: 2 },
        ],
        [{ movePct: 0, gexUsdMillions: 3 }],
      ]),
    ).toEqual([
      { movePct: 0, gexUsdMillions: 5 },
      { movePct: 0.005, gexUsdMillions: 1 },
    ]);
  });
});
