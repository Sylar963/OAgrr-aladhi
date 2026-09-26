import { describe, expect, it } from 'vitest';
import type { EnrichedChainResponse, VenueQuote } from '@shared/enriched';
import {
  expiryPnl,
  scanCrossVenueSpreads,
  scanSpreads,
  type SpreadScanInput,
} from './spread-scanner';

const now = Date.UTC(2026, 8, 18);
function quote(bid: number, ask: number): VenueQuote {
  return {
    bid,
    ask,
    mid: (bid + ask) / 2,
    midRaw: (bid + ask) / 2,
    bidSize: 1,
    askSize: 1,
    markIv: 0.4,
    bidIv: 0.39,
    askIv: 0.41,
    delta: null,
    gamma: null,
    theta: null,
    vega: null,
    spreadPct: null,
    totalCost: null,
    estimatedFees: null,
    openInterest: null,
    volume24h: null,
    openInterestUsd: null,
    volume24hUsd: null,
    asOfMs: now,
    underlyingPriceUsd: 80_000,
    execution: {
      exchangeSymbol: 'BTC-TEST',
      settleCurrency: 'USD',
      inverse: false,
      quantityUnit: 'base',
      contractMultiplierBase: 1,
      nativeMinQuantity: 0.01,
      nativeQuantityStep: 0.01,
      nativePriceTick: 5,
      minQuantity: 0.01,
      quantityStep: 0.01,
      bidSize: 1,
      askSize: 1,
      bidUsd: bid,
      askUsd: ask,
      markUsd: (bid + ask) / 2,
      bidMakerFeeUsd: 12,
      askMakerFeeUsd: 12,
      bidTakerFeeUsd: 12,
      askTakerFeeUsd: 12,
    },
  };
}
function input(): SpreadScanInput {
  const chain: EnrichedChainResponse = {
    underlying: 'BTC',
    expiry: '2026-09-25',
    expiryTs: now + 7 * 86_400_000,
    dte: 7,
    stats: {
      forwardPriceUsd: 80_000,
      indexPriceUsd: 80_000,
      basisPct: 0,
      atmStrike: 80_000,
      atmIv: 0.4,
      putCallOiRatio: null,
      totalOiUsd: null,
      skew25d: null,
      bfly25d: null,
    },
    gex: [],
    strikes: [
      {
        strike: 80_000,
        call: { venues: { thalex: quote(1000, 1100) }, bestIv: 0.4, bestVenue: 'thalex' },
        put: { venues: { thalex: quote(1000, 1100) }, bestIv: 0.4, bestVenue: 'thalex' },
      },
      {
        strike: 81_000,
        call: { venues: { thalex: quote(600, 700) }, bestIv: 0.4, bestVenue: 'thalex' },
        put: { venues: { thalex: quote(1400, 1500) }, bestIv: 0.4, bestVenue: 'thalex' },
      },
    ],
  };
  return {
    chain,
    venues: ['thalex'],
    quantity: 0.01,
    equity: 1080,
    riskPct: 1,
    costReserve: 0.25,
    nowMs: now,
  };
}
const candidates = (i = input()) => scanSpreads(i)[0]!.candidates;

describe('venue-specific spread scanner', () => {
  it('prices all four structures at bid/ask and actual size with one Thalex combo fee', () => {
    const rows = candidates();
    expect(rows).toHaveLength(4);
    for (const c of rows) {
      expect(c.entryFee).toBeCloseTo(0.12);
      expect(c.maxLoss + c.maxProfit).toBeCloseTo(10);
      if (c.kind.endsWith('credit')) {
        expect(c.grossPremium).toBeCloseTo(3);
        expect(c.maxProfit).toBeCloseTo(2.63);
        expect(c.maxLoss).toBeCloseTo(7.37);
      } else {
        expect(c.grossPremium).toBeCloseTo(-5);
        expect(c.maxLoss).toBeCloseTo(5.37);
        expect(c.maxProfit).toBeCloseTo(4.63);
      }
    }
  });
  it('matches terminal extrema and breakeven for every structure', () => {
    for (const c of candidates()) {
      const values = [0, 79_000, 80_000, 80_500, 81_000, 100_000].map((spot) => expiryPnl(c, spot));
      expect(Math.max(...values)).toBeCloseTo(c.maxProfit);
      expect(Math.min(...values)).toBeCloseTo(-c.maxLoss);
      expect(expiryPnl(c, c.breakeven)).toBeCloseTo(0);
      expect(c.modelEdge).toBeGreaterThanOrEqual(-c.maxLoss);
      expect(c.modelEdge).toBeLessThanOrEqual(c.maxProfit);
    }
  });
  it('scales quantity without confusing per-BTC economics and account risk', () => {
    const i = input();
    i.quantity = 0.1;
    for (const c of candidates(i)) {
      expect(c.entryFee).toBeCloseTo(1.2);
      expect(c.status).toBe('over-budget');
      expect(c.riskPct).toBeCloseTo((c.maxLoss / 1080) * 100);
    }
  });
  it.each([0, -1, NaN, Infinity])('rejects invalid quantity %s', (q) => {
    const i = input();
    i.quantity = q;
    expect(candidates(i)).toHaveLength(0);
  });
  it.each([0.001, 0.015, 2])('rejects below-minimum, off-step or excessive size %s', (q) => {
    const i = input();
    i.quantity = q;
    expect(candidates(i)).toHaveLength(0);
  });
  it('never pairs legs across venues', () => {
    const i = input();
    const row = i.chain.strikes[1]!;
    row.call.venues.bybit = row.call.venues.thalex;
    row.put.venues.bybit = row.put.venues.thalex;
    delete row.call.venues.thalex;
    delete row.put.venues.thalex;
    i.venues = ['thalex', 'bybit'];
    expect(scanSpreads(i).flatMap((r) => r.candidates)).toHaveLength(0);
  });
  it.each([
    'missing',
    'stale',
    'skew',
    'inverse',
    'fee',
    'settlement',
    'crossed',
  ] as const)('rejects %s data', (issue) => {
    const i = input();
    for (const side of ['call', 'put'] as const) {
      const q = i.chain.strikes[0]![side].venues.thalex!;
      if (issue === 'missing') q.execution = null;
      if (issue === 'stale') q.asOfMs = now - 16_000;
      if (issue === 'skew') q.asOfMs = now - 3_000;
      if (issue === 'inverse') q.execution!.inverse = true;
      if (issue === 'fee') {
        q.execution!.bidTakerFeeUsd = null;
        q.execution!.askTakerFeeUsd = null;
      }
      if (issue === 'settlement') q.execution!.settleCurrency = 'BTC';
      if (issue === 'crossed') q.execution!.bidUsd = 9999;
    }
    expect(candidates(i)).toHaveLength(0);
    expect(Object.keys(scanSpreads(i)[0]!.rejected).length).toBeGreaterThan(0);
  });
  it('expires cached quotes even if the feed stops updating', () => {
    const i = input();
    i.nowMs += 16_000;
    expect(candidates(i)).toHaveLength(0);
  });
  it('reports unavailable model inputs rather than inferring an edge', () => {
    const i = input();
    for (const row of i.chain.strikes)
      for (const side of ['call', 'put'] as const) row[side].venues.thalex!.markIv = null;
    expect(candidates(i).every((c) => c.status === 'no-model' && c.probability === null)).toBe(
      true,
    );
  });
  it('uses a user forecast only when explicitly supplied', () => {
    const i = input();
    const base = candidates(i).find((c) => c.kind === 'call-debit')!;
    i.forecast = { movePct: 10, volatility: 0.4 };
    const forecast = candidates(i).find((c) => c.kind === 'call-debit')!;
    expect(base.model).toBe('market');
    expect(forecast.model).toBe('forecast');
    expect(forecast.modelEdge!).toBeGreaterThan(base.modelEdge!);
    expect(forecast.probability!).toBeGreaterThan(base.probability!);
  });
});

describe('cross-venue spread scanner', () => {
  const cross = (i: SpreadScanInput) => scanCrossVenueSpreads(i, scanSpreads(i));
  function twoVenues(): SpreadScanInput {
    const i = input();
    for (const row of i.chain.strikes)
      for (const side of ['call', 'put'] as const) {
        const q = row[side].venues.thalex!;
        row[side].venues.bybit = { ...q, execution: { ...q.execution! } };
      }
    i.venues = ['thalex', 'bybit'];
    return i;
  }

  it('pairs legs across venues with standalone per-leg fees and groups by short venue', () => {
    const i = input();
    const row = i.chain.strikes[1]!;
    row.call.venues.bybit = row.call.venues.thalex;
    row.put.venues.bybit = row.put.venues.thalex;
    delete row.call.venues.thalex;
    delete row.put.venues.thalex;
    i.venues = ['thalex', 'bybit'];
    const [thalex, bybit] = cross(i);
    const all = [...thalex!.candidates, ...bybit!.candidates];
    expect(all).toHaveLength(4);
    for (const c of all) {
      expect(c.buyVenue).not.toBe(c.venue);
      expect(c.entryFee).toBeCloseTo(0.24);
      expect(c.sellFee + c.buyFee).toBeCloseTo(c.entryFee);
      expect(c.crossImprovement).toBeNull();
      expect(c.sellStrike).toBe(c.venue === 'thalex' ? 80_000 : 81_000);
    }
  });
  it('drops routes that do not beat the best same-venue price', () => {
    const [thalex, bybit] = cross(twoVenues());
    expect([...thalex!.candidates, ...bybit!.candidates]).toHaveLength(0);
    expect(thalex!.rejected['Same-venue route is as good or better']).toBeGreaterThan(0);
  });
  it('reports the improvement over the best same-venue pair', () => {
    const i = twoVenues();
    i.chain.strikes[1]!.call.venues.bybit!.execution!.bidUsd = 700;
    i.chain.strikes[0]!.call.venues.bybit!.execution!.askUsd = 1200;
    const route = cross(i)
      .find((scan) => scan.venue === 'bybit')!
      .candidates.find((c) => c.kind === 'call-debit' && c.buyVenue === 'thalex')!;
    expect(route.grossPremium).toBeCloseTo(-4);
    expect(route.entryFee).toBeCloseTo(0.24);
    expect(route.crossImprovement).toBeCloseTo(0.88);
    for (let spot = 70_000; spot <= 90_000; spot += 500)
      expect(expiryPnl(route, spot)).toBeLessThanOrEqual(route.maxProfit + 1e-9);
  });
  it('requires a second venue', () => {
    const [scan] = cross(input());
    expect(scan!.candidates).toHaveLength(0);
    expect(scan!.rejected['Enable a second venue to route across venues']).toBe(1);
  });
});
