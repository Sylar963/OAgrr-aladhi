import type { NormalizedOptionContract } from '@oggregator/core';
import { AlphaLottoScannerQuerySchema } from '@oggregator/protocol';
import { describe, expect, it } from 'vitest';

import { computeLottoCandidate, rankLottoCandidates } from './alpha-lotto-scanner.js';

const NOW_MS = 1_800_000_000_000;
const config = AlphaLottoScannerQuerySchema.parse({});

function contract(overrides: Partial<NormalizedOptionContract> = {}): NormalizedOptionContract {
  return {
    venue: 'thalex',
    symbol: 'BTC/USD:USD-260904-90000-C',
    exchangeSymbol: 'BTC-04SEP26-90000-C',
    base: 'BTC',
    settle: 'USD',
    expiry: '2026-09-04',
    expiryTs: NOW_MS + 9 * 86_400_000,
    strike: 90_000,
    right: 'call',
    inverse: false,
    contractSize: 1,
    tickSize: 5,
    minQty: 0.01,
    makerFee: null,
    takerFee: null,
    greeks: {
      delta: 0.035,
      gamma: null,
      theta: -12,
      vega: null,
      rho: null,
      markIv: 0.49,
      bidIv: 0.48,
      askIv: 0.51,
    },
    quote: {
      bid: { raw: 80, rawCurrency: 'USD', usd: 80 },
      ask: { raw: 110, rawCurrency: 'USD', usd: 110 },
      mark: { raw: 100, rawCurrency: 'USD', usd: 100 },
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
      timestamp: NOW_MS - 1_000,
      source: 'ws',
    },
    ...overrides,
  };
}

const market = {
  indexPrice: 78_000,
  forwardPrice: 78_140,
  nowMs: NOW_MS,
};

describe('computeLottoCandidate', () => {
  it('computes sizing, expiry breakeven, targets, and rip scenarios', () => {
    const result = computeLottoCandidate(contract(), market, config);
    expect(result.skipReason).toBeNull();
    if (result.candidate == null) throw new Error('expected candidate');

    expect(result.candidate.otmPct).toBeCloseTo(15.3846, 3);
    expect(result.candidate.breakEvenPrice).toBe(90_100);
    expect(result.candidate.breakEvenMovePct).toBeCloseTo(15.5128, 3);
    expect(result.candidate.contractsAtMark).toBe(24);
    expect(result.candidate.contractsAtAsk).toBe(21);
    expect(result.candidate.conservativeContracts).toBe(18);

    const tenX = result.candidate.targets.find((target) => target.multiple === 10);
    expect(tenX?.targetMark).toBe(1_000);
    expect(tenX?.intrinsicBtcPrice).toBe(91_000);
    expect(tenX?.black76BtcPrice).not.toBeNull();
    expect(tenX!.black76BtcPrice!).toBeLessThan(tenX!.intrinsicBtcPrice);

    const twentyPct = result.candidate.shocks.find((shock) => shock.movePct === 20);
    expect(twentyPct?.btcPrice).toBe(93_600);
    expect(twentyPct?.intrinsicValue).toBe(3_600);
    expect(twentyPct?.intrinsicMultiple).toBe(36);
  });

  it('rejects missing and excessively wide markets', () => {
    const missingAsk = contract({
      quote: { ...contract().quote, ask: { raw: null, rawCurrency: 'USD', usd: null } },
    });
    expect(computeLottoCandidate(missingAsk, market, config).skipReason).toBe('missing_market');

    const wide = contract({
      quote: {
        ...contract().quote,
        bid: { raw: 10, rawCurrency: 'USD', usd: 10 },
        ask: { raw: 110, rawCurrency: 'USD', usd: 110 },
      },
    });
    expect(computeLottoCandidate(wide, market, config).skipReason).toBe('wide_spread');
  });
});

describe('rankLottoCandidates', () => {
  it('ranks mark first and spread as a later tie-breaker', () => {
    const first = computeLottoCandidate(contract(), market, config);
    const cheaper = computeLottoCandidate(
      contract({
        exchangeSymbol: 'BTC-04SEP26-95000-C',
        strike: 95_000,
        quote: {
          ...contract().quote,
          bid: { raw: 40, rawCurrency: 'USD', usd: 40 },
          ask: { raw: 60, rawCurrency: 'USD', usd: 60 },
          mark: { raw: 50, rawCurrency: 'USD', usd: 50 },
        },
      }),
      market,
      config,
    );
    if (first.candidate == null || cheaper.candidate == null) throw new Error('expected candidates');

    const ranked = rankLottoCandidates([first.candidate, cheaper.candidate]);
    expect(ranked.map((candidate) => candidate.mark)).toEqual([50, 100]);
  });
});
