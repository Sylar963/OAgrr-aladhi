import type { EnrichedChainResponse, VenueQuote } from '@shared/enriched';
import type { SpreadScanInput } from './vertical-pricing';

export const now = Date.UTC(2026, 8, 18);
export function quote(bid: number, ask: number): VenueQuote {
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
export function input(): SpreadScanInput {
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
