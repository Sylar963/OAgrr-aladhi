import { describe, expect, it } from 'vitest';
import type { EnrichedChainResponse } from '@oggregator/protocol';
import type { Leg } from './payoff';
import { buildVenueExecution } from './VenueSlideover';

const leg: Leg = {
  id: 'leg-1',
  type: 'call',
  direction: 'buy',
  strike: 70_000,
  expiry: '2026-06-26',
  quantity: 0.05,
  entryPrice: 4_200,
  venue: 'okx',
  delta: null,
  gamma: null,
  theta: null,
  vega: null,
  iv: null,
};

const quote = {
  bid: 28,
  ask: 42,
  mid: 35,
  midRaw: 0.05,
  bidSize: 20,
  askSize: 30,
  markIv: 0.5,
  bidIv: null,
  askIv: null,
  delta: 0.5,
  gamma: null,
  theta: null,
  vega: null,
  spreadPct: 40,
  totalCost: null,
  estimatedFees: null,
  openInterest: null,
  volume24h: null,
  openInterestUsd: null,
  volume24hUsd: null,
  execution: {
    exchangeSymbol: 'BTC-USD-260626-70000-C',
    settleCurrency: 'BTC',
    inverse: true,
    quantityUnit: 'base' as const,
    contractMultiplierBase: 0.01,
    nativeMinQuantity: 1,
    nativeQuantityStep: 1,
    nativePriceTick: 0.0001,
    minQuantity: 0.01,
    quantityStep: 0.01,
    bidSize: 0.2,
    askSize: 0.3,
    bidUsd: 2_800,
    askUsd: 4_200,
    markUsd: 3_500,
    bidMakerFeeUsd: 14,
    bidTakerFeeUsd: 21,
    askMakerFeeUsd: 14,
    askTakerFeeUsd: 21,
  },
};

const chain: EnrichedChainResponse = {
  underlying: 'BTC',
  expiry: '2026-06-26',
  expiryTs: null,
  dte: 30,
  stats: {
    forwardPriceUsd: 70_000,
    indexPriceUsd: 70_000,
    basisPct: 0,
    atmStrike: 70_000,
    atmIv: 0.5,
    putCallOiRatio: null,
    totalOiUsd: null,
    skew25d: null,
    bfly25d: null,
  },
  strikes: [
    {
      strike: 70_000,
      call: { venues: { okx: quote }, bestIv: 0.5, bestVenue: 'okx' },
      put: { venues: {}, bestIv: null, bestVenue: null },
    },
  ],
  gex: [],
};

describe('buildVenueExecution', () => {
  it('uses the canonical execution projection instead of analytics units', () => {
    expect(buildVenueExecution(chain, 'okx', leg)).toMatchObject({
      bidPrice: 2_800,
      askPrice: 4_200,
      bidSize: 0.2,
      askSize: 0.3,
      contractSize: 1,
      minQty: 0.01,
      quantityStep: 0.01,
      bidTakerFeeUsd: 21,
      askTakerFeeUsd: 21,
    });
  });

  it('excludes analytics-only venues', () => {
    const analyticsOnly = structuredClone(chain);
    delete analyticsOnly.strikes[0]?.call.venues.okx?.execution;

    expect(buildVenueExecution(analyticsOnly, 'okx', leg)).toBeNull();
  });
});
