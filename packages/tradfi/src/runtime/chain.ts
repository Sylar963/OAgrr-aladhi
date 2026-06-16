import {
  buildComparisonChain,
  buildEnrichedChain,
  type BookLookup,
  type DealerPosition,
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
import type { TradfiFlowBook } from './flow-book.js';

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

function quoteMark(q: TradfiLiveQuote): number | null {
  if (q.mark != null) return q.mark;
  if (q.bid != null && q.ask != null) return (q.bid + q.ask) / 2;
  return null;
}

// Synthetic forward from put-call parity at the strike nearest spot that has
// both a call and put mark: F = K + (callMark − putMark). Undiscounted — for
// the short equity tenors shown here the discount factor sits inside the basis
// chip's flat band, and we have no clean per-name rate to discount with.
// Returns null when no usable ATM pair exists so the caller falls back to spot
// (which yields basis 0 — the prior behavior, now confined to warming chains).
function deriveForward(
  insts: TradfiInstrument[],
  store: TradfiStore,
  spot: number | null,
): number | null {
  if (spot == null) return null;
  const byStrike = new Map<number, { strike: number; call: number | null; put: number | null }>();
  for (const inst of insts) {
    const q = store.getQuote(inst.streamerSymbol);
    if (q == null) continue;
    const mark = quoteMark(q);
    if (mark == null) continue;
    const pair = byStrike.get(inst.strike) ?? { strike: inst.strike, call: null, put: null };
    if (inst.right === 'call') pair.call = mark;
    else pair.put = mark;
    byStrike.set(inst.strike, pair);
  }

  let best: { strike: number; call: number; put: number } | null = null;
  let bestDist = Infinity;
  for (const pair of byStrike.values()) {
    if (pair.call == null || pair.put == null) continue;
    const dist = Math.abs(pair.strike - spot);
    if (dist < bestDist) {
      bestDist = dist;
      best = { strike: pair.strike, call: pair.call, put: pair.put };
    }
  }
  return best == null ? null : best.strike + (best.call - best.put);
}

function toContract(
  inst: TradfiInstrument,
  quote: TradfiLiveQuote,
  forward: number | null,
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
      // underlyingPriceUsd is the forward-to-expiry (matches Deribit
      // underlying_price / OKX fwdPx); indexPriceUsd is spot. Core derives the
      // basis from their difference, so these MUST differ for the regime chip.
      underlyingPriceUsd: forward,
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
  flowBook?: TradfiFlowBook,
): EnrichedChainResponse {
  const insts = store.instrumentsFor(underlying, expiry);
  const spot = store.getSpot(underlying);
  const forward = deriveForward(insts, store, spot) ?? spot;
  const contracts: Record<string, NormalizedOptionContract> = {};

  for (const inst of insts) {
    const quote = store.getQuote(inst.streamerSymbol) ?? emptyQuote();
    contracts[inst.canonical] = toContract(inst, quote, forward, spot, source);
  }

  const venueChain: VenueOptionChain = {
    venue: TASTYTRADE_VENUE,
    underlying,
    expiry,
    asOf: Date.now(),
    contracts,
  };

  // Live-signed dealer book: magnitude from current OI, sign refined by net taker
  // flow. dealerContracts = naiveBase − netFlow, where naiveBase = ±OI. At zero
  // flow this reproduces the naive GEX exactly (computeGex negates puts itself).
  const lookup: BookLookup | undefined = flowBook
    ? (_venue, symbol) => {
        const c = contracts[symbol];
        if (c == null) return undefined;
        const oi = c.quote.openInterest;
        if (oi == null) return undefined;
        const naiveBase = c.right === 'call' ? oi : -oi;
        const pos: DealerPosition = {
          venue: TASTYTRADE_VENUE,
          symbol,
          underlying,
          expiry,
          strike: c.strike,
          optionType: c.right,
          dealerContracts: naiveBase - flowBook.netFlowFor(symbol),
          lastOi: oi,
          lastSnapshotTs: c.quote.timestamp ?? Date.now(),
        };
        return pos;
      }
    : undefined;

  const comparison = buildComparisonChain(underlying, expiry, [venueChain]);
  return buildEnrichedChain(underlying, expiry, comparison.rows, [venueChain], lookup);
}
