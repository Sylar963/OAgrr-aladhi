import {
  buildComparisonChain,
  buildEnrichedChain,
  EMPTY_GREEKS,
  type EnrichedChainResponse,
  type NormalizedOptionContract,
  type PremiumValue,
  type VenueId,
  type VenueOptionChain,
} from '@oggregator/core';
import type { TradfiStore, TradfiLiveQuote } from './store.js';
import { emptyQuote } from './store.js';
import type { TradfiInstrument } from '../tastytrade/instrument.js';

// TradFi is a separate service; the shared core chain/enrichment types are keyed
// by the crypto VenueId union. We widen "tastytrade" to VenueId at this single
// boundary — enrichment stores it in Partial<Record<VenueId>> maps keyed by this
// string, so it flows through to the response as `venues.tastytrade` unchanged.
const TASTYTRADE_VENUE = 'tastytrade' as VenueId;

function premium(value: number | null): PremiumValue {
  return { raw: value, rawCurrency: 'USD', usd: value };
}

// USD notional for OI/volume: contracts × shares-per-contract × underlying spot.
// Mirrors core's normalizeOpenInterestUsd so TradFi aggregates (totalOiUsd,
// put/call OI ratio) populate instead of summing nulls to zero.
function notionalUsd(qty: number | null, multiplier: number, spot: number | null): number | null {
  return qty != null && spot != null ? qty * multiplier * spot : null;
}

function toContract(
  inst: TradfiInstrument,
  quote: TradfiLiveQuote,
  spot: number | null,
  source: 'ws' | 'rest',
): NormalizedOptionContract {
  return {
    venue: TASTYTRADE_VENUE,
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
      openInterestUsd: notionalUsd(quote.openInterest, inst.multiplier, spot),
      volume24hUsd: notionalUsd(quote.volume, inst.multiplier, spot),
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
    venue: TASTYTRADE_VENUE,
    underlying,
    expiry,
    asOf: Date.now(),
    contracts,
  };

  const comparison = buildComparisonChain(underlying, expiry, [venueChain]);
  return buildEnrichedChain(underlying, expiry, comparison.rows, [venueChain]);
}
