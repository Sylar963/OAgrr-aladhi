import {
  buildComparisonChain,
  buildEnrichedChain,
  EMPTY_GREEKS,
  type EnrichedChainResponse,
  type NormalizedOptionContract,
  type PremiumValue,
  type VenueOptionChain,
} from '@oggregator/core';
import type { TradfiStore, TradfiLiveQuote } from './store.js';
import { emptyQuote } from './store.js';
import type { TradfiInstrument } from '../tastytrade/instrument.js';

function premium(value: number | null): PremiumValue {
  return { raw: value, rawCurrency: 'USD', usd: value };
}

function toContract(
  inst: TradfiInstrument,
  quote: TradfiLiveQuote,
  spot: number | null,
  source: 'ws' | 'rest',
): NormalizedOptionContract {
  return {
    venue: 'tastytrade',
    symbol: inst.canonical,
    exchangeSymbol: inst.streamerSymbol,
    base: inst.underlying,
    settle: 'USD',
    expiry: inst.expiry,
    expiryTs: null,
    strike: inst.strike,
    right: inst.right,
    inverse: false,
    contractSize: inst.multiplier,
    tickSize: null,
    minQty: null,
    makerFee: null,
    takerFee: null,
    greeks: {
      ...EMPTY_GREEKS,
      delta: quote.delta,
      gamma: quote.gamma,
      theta: quote.theta,
      vega: quote.vega,
      rho: quote.rho,
      markIv: quote.iv,
    },
    quote: {
      bid: premium(quote.bid),
      ask: premium(quote.ask),
      mark: premium(quote.mark),
      last: quote.last != null ? premium(quote.last) : null,
      bidSize: quote.bidSize,
      askSize: quote.askSize,
      underlyingPriceUsd: spot,
      indexPriceUsd: spot,
      volume24h: quote.volume,
      openInterest: quote.openInterest,
      openInterestUsd: null,
      volume24hUsd: null,
      estimatedFees: null,
      timestamp: quote.ts || null,
      source,
    },
  };
}

export function buildChain(
  store: TradfiStore,
  underlying: string,
  expiry: string,
  source: 'ws' | 'rest' = 'ws',
): EnrichedChainResponse {
  const insts = store.instrumentsFor(underlying, expiry);
  const spot = store.getSpot(underlying);
  const contracts: Record<string, NormalizedOptionContract> = {};

  for (const inst of insts) {
    const quote = store.getQuote(inst.streamerSymbol) ?? emptyQuote();
    contracts[inst.canonical] = toContract(inst, quote, spot, source);
  }

  const venueChain: VenueOptionChain = {
    venue: 'tastytrade',
    underlying,
    expiry,
    asOf: Date.now(),
    contracts,
  };

  const comparison = buildComparisonChain(underlying, expiry, [venueChain]);
  return buildEnrichedChain(underlying, expiry, comparison.rows, [venueChain]);
}
