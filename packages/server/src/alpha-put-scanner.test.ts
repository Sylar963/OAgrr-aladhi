import { price76 } from '@oggregator/core';
import type { NormalizedOptionContract } from '@oggregator/core';
import { AlphaPutScannerQuerySchema } from '@oggregator/protocol';
import { describe, expect, it } from 'vitest';

import {
  buildHedge,
  computePutCandidate,
  rankPutCandidates,
  rankPutCandidatesAcrossExpiries,
} from './alpha-put-scanner.js';

const NOW_MS = 1_800_000_000_000;
const config = AlphaPutScannerQuerySchema.parse({ hedgeQty: 1.5 });

function quote(bid: number, ask: number, mark: number) {
  return {
    bid: { raw: bid, rawCurrency: 'USD', usd: bid },
    ask: { raw: ask, rawCurrency: 'USD', usd: ask },
    mark: { raw: mark, rawCurrency: 'USD', usd: mark },
  };
}

function contract(overrides: Partial<NormalizedOptionContract> = {}): NormalizedOptionContract {
  return {
    venue: 'thalex',
    symbol: 'BTC/USD:USD-260904-70000-P',
    exchangeSymbol: 'BTC-04SEP26-70000-P',
    base: 'BTC',
    settle: 'USD',
    expiry: '2026-09-04',
    expiryTs: NOW_MS + 9 * 86_400_000,
    strike: 70_000,
    right: 'put',
    inverse: false,
    contractSize: 1,
    tickSize: 5,
    minQty: 0.01,
    makerFee: null,
    takerFee: null,
    greeks: {
      delta: -0.18,
      gamma: null,
      theta: -40,
      vega: null,
      rho: null,
      markIv: 0.55,
      bidIv: 0.54,
      askIv: 0.56,
    },
    quote: {
      ...quote(900, 1_000, 950),
      last: null,
      bidSize: 2,
      askSize: 2,
      underlyingPriceUsd: 78_140,
      indexPriceUsd: 78_000,
      volume24h: 0,
      openInterest: 0,
      openInterestUsd: 0,
      volume24hUsd: 0,
      estimatedFees: null,
      estimatedAskFees: { maker: 0, taker: 10 },
      timestamp: NOW_MS - 1_000,
      source: 'ws',
    },
    ...overrides,
  };
}

const market = {
  indexPrice: 78_000,
  forwardPrice: 78_140,
  referenceSource: 'venue-forward' as const,
  atmIv: 0.4,
  nowMs: NOW_MS,
};

function candidateOf(overrides: Partial<NormalizedOptionContract> = {}) {
  const result = computePutCandidate(contract(overrides), market, config);
  if (result.candidate == null) throw new Error(`expected candidate, got ${result.skipReason}`);
  return result.candidate;
}

describe('computePutCandidate', () => {
  it('measures moneyness and breakeven below spot', () => {
    const candidate = candidateOf();

    expect(candidate.otmPct).toBeCloseTo(10.2564, 3);
    expect(candidate.entryCost).toBe(1_010);
    expect(candidate.breakEvenPrice).toBe(68_990);
    expect(candidate.breakEvenMovePct).toBeCloseTo(-11.5513, 3);
    expect(candidate.quantityAtAsk).toBe(2);
  });

  it('prices protection per unit of underlying held', () => {
    const { protection } = candidateOf();

    expect(protection.premiumPerUnit).toBe(1_010);
    expect(protection.costPct).toBeCloseTo(1.29487, 4);
    expect(protection.annualizedCostPct).toBeCloseTo(52.5143, 3);
    expect(protection.maxLossPct).toBeCloseTo(11.5513, 3);
    expect(protection.upsideBreakEvenPrice).toBe(79_010);
    expect(protection.skewPremium).toBeCloseTo(0.15, 8);
  });

  it('sizes the hedge to the holding and reports the floor loss', () => {
    const { hedge } = candidateOf();

    expect(hedge).toEqual({
      targetQty: 1.5,
      contracts: 1.5,
      coveredQty: 1.5,
      cost: 1_515,
      costPctOfHolding: expect.closeTo(1.29487, 4),
      maxLoss: 13_515,
      maxLossPct: expect.closeTo(11.5513, 3),
      fullyCovered: true,
    });
  });

  it('omits the hedge when no holding is supplied', () => {
    const result = computePutCandidate(
      contract(),
      market,
      AlphaPutScannerQuerySchema.parse({}),
    );
    expect(result.candidate?.hedge).toBeNull();
  });

  it('uses negative shocks with put intrinsic value', () => {
    const shock = candidateOf().shocks.find((entry) => entry.movePct === -20);

    expect(shock?.underlyingPrice).toBe(62_400);
    expect(shock?.intrinsicValue).toBe(7_600);
    expect(shock?.intrinsicMultiple).toBeCloseTo(7_600 / 1_010, 8);
  });

  it('solves the downside move for a put payoff multiple', () => {
    const candidate = candidateOf();
    const twoX = candidate.targets.find((target) => target.multiple === 2)!;

    expect(twoX.intrinsicUnderlyingPrice).toBe(67_980);
    expect(twoX.modelUnderlyingPrice).not.toBeNull();
    expect(twoX.modelUnderlyingPrice!).toBeGreaterThan(twoX.intrinsicUnderlyingPrice!);
    expect(twoX.modelMovePct!).toBeLessThan(0);
    expect(twoX.impliedMoveMultiple!).toBeGreaterThan(0);

    const forward = twoX.modelUnderlyingPrice! * (market.forwardPrice / market.indexPrice);
    expect(price76(forward, 70_000, 0.55, 9 / 365, 'put')).toBeCloseTo(2_020, 4);
  });

  it('returns null targets when the multiple exceeds the strike', () => {
    const candidate = candidateOf({ quote: { ...contract().quote, ...quote(7_500, 8_000, 7_750) } });
    const tenX = candidate.targets.find((target) => target.multiple === 10)!;

    expect(tenX.intrinsicUnderlyingPrice).toBeNull();
    expect(tenX.modelUnderlyingPrice).toBeNull();
  });

  it('skips calls, ITM puts beyond the band, and wide markets', () => {
    expect(computePutCandidate(contract({ right: 'call' }), market, config).skipReason).toBe('not_put');
    expect(computePutCandidate(contract({ strike: 80_000 }), market, config).skipReason).toBe('outside_otm');
    expect(
      computePutCandidate(
        contract({ quote: { ...contract().quote, ...quote(100, 1_000, 500) } }),
        market,
        config,
      ).skipReason,
    ).toBe('wide_spread');
  });
});

describe('buildHedge', () => {
  it('rounds contracts up to the venue increment', () => {
    expect(buildHedge(0.333, 70_000, 1, 0.1, 1_000, 5, 78_000)?.contracts).toBe(0.4);
  });

  it('keeps unhedged units exposed to zero when ask size runs out', () => {
    const hedge = buildHedge(1.5, 70_000, 1, 0.01, 1_010, 1, 78_000)!;

    expect(hedge.fullyCovered).toBe(false);
    expect(hedge.coveredQty).toBe(1);
    expect(hedge.maxLoss).toBe(1.5 * 78_000 - 70_000 + 1_010);
  });
});

describe('rankPutCandidates', () => {
  const tight = candidateOf({ exchangeSymbol: 'BTC-P-75000', strike: 75_000, quote: { ...contract().quote, ...quote(2_000, 2_100, 2_050) } });
  const mid = candidateOf();
  const tail = candidateOf({ exchangeSymbol: 'BTC-P-60000', strike: 60_000, quote: { ...contract().quote, ...quote(150, 160, 155) } });

  it('ranks protection by worst-case loss', () => {
    expect(rankPutCandidates([tail, mid, tight], 'protection').map((c) => c.strike)).toEqual([
      75_000, 70_000, 60_000,
    ]);
  });

  it('interleaves tight floors with cheap tails within an expiry', () => {
    const ranked = rankPutCandidatesAcrossExpiries([tail, mid, tight], 'protection', 2);
    expect(ranked.map((c) => c.strike)).toEqual([75_000, 60_000]);
  });

  it('round-robins across expiries', () => {
    const later = { ...mid, expiry: '2026-10-02' };
    const ranked = rankPutCandidatesAcrossExpiries([tight, tail, later], 'protection', 2);
    expect(ranked.map((c) => c.expiry)).toEqual(['2026-09-04', '2026-10-02']);
  });
});
