import type { CachedInstrument, LiveQuote } from '../shared/sdk-base.js';
import type { OptionRight } from '../../types/common.js';
import {
  THALEX_OPTION_SYMBOL_RE,
  type ThalexInstrument,
  type ThalexTicker,
} from './types.js';

function mergeNumber(next: number | undefined | null, previous: number | null): number | null {
  return next ?? previous;
}

/**
 * Thalex ticker merge.
 *
 * Field map (see references/options-docs/thalex/ticker-pushes.json):
 *   best_bid_price / best_bid_amount → bidPrice / bidSize
 *   best_ask_price / best_ask_amount → askPrice / askSize
 *   mark_price / last_price          → markPrice / lastPrice
 *   index                            → underlyingPrice
 *   volume_24h / open_interest       → volume24h / openInterest
 *   iv   → greeks.markIv             (native fraction; no ivToFraction)
 *   delta → greeks.delta
 *   mark_timestamp (seconds, float)  → timestamp (ms)
 *
 * Thalex never sends gamma/theta/vega/rho/bidIv/askIv. Those are preserved
 * from the previous quote (which is usually `null` for Thalex contracts).
 */
export function mergeThalexTicker(
  ticker: ThalexTicker,
  previous: LiveQuote | undefined,
  empty: LiveQuote,
): LiveQuote {
  const base = previous ?? empty;
  return {
    bidPrice: mergeNumber(ticker.best_bid_price, base.bidPrice),
    askPrice: mergeNumber(ticker.best_ask_price, base.askPrice),
    bidSize: mergeNumber(ticker.best_bid_amount, base.bidSize),
    askSize: mergeNumber(ticker.best_ask_amount, base.askSize),
    markPrice: mergeNumber(ticker.mark_price, base.markPrice),
    lastPrice: mergeNumber(ticker.last_price, base.lastPrice),
    underlyingPrice: mergeNumber(ticker.index, base.underlyingPrice),
    indexPrice: mergeNumber(ticker.index, base.indexPrice),
    volume24h: mergeNumber(ticker.volume_24h, base.volume24h),
    openInterest: mergeNumber(ticker.open_interest, base.openInterest),
    openInterestUsd: base.openInterestUsd,
    volume24hUsd: mergeNumber(ticker.value_24h, base.volume24hUsd),
    greeks: {
      delta: mergeNumber(ticker.delta, base.greeks.delta),
      gamma: base.greeks.gamma,
      theta: base.greeks.theta,
      vega: base.greeks.vega,
      rho: base.greeks.rho,
      markIv: mergeNumber(ticker.iv, base.greeks.markIv),
      bidIv: base.greeks.bidIv,
      askIv: base.greeks.askIv,
    },
    timestamp: Math.round(ticker.mark_timestamp * 1000),
  };
}

export interface ThalexInstrumentDeps {
  buildCanonicalSymbol: (
    base: string,
    settle: string,
    expiry: string,
    strike: number,
    right: OptionRight,
  ) => string;
  parseExpiry: (raw: string) => string;
}

/**
 * Translate a Thalex instrument row into the adapter's CachedInstrument.
 *
 * Filters out anything that's not an option. Uses the DDMMMYY token from
 * the native symbol as the expiry source of truth (same as Deribit), with
 * expiration_timestamp (seconds → ms) carried forward for downstream
 * time-to-expiry math.
 *
 * Returns null for non-options or malformed symbols.
 */
export function buildThalexInstrument(
  item: ThalexInstrument,
  deps: ThalexInstrumentDeps,
): CachedInstrument | null {
  if (item.type !== 'option') return null;

  const match = THALEX_OPTION_SYMBOL_RE.exec(item.instrument_name);
  if (!match) return null;

  const base = match[1]!;
  const expiryToken = match[2]!;
  const strike = Number(match[3]!);
  const right: OptionRight = match[4] === 'C' ? 'call' : 'put';
  if (!Number.isFinite(strike) || strike <= 0) return null;

  // Thalex is linear USD-settled (stablecoin). No inverse math ever.
  const settle = 'USD';
  const expiry = item.expiry_date ?? deps.parseExpiry(expiryToken);

  const canonical = deps.buildCanonicalSymbol(base, settle, expiry, strike, right);

  const expirationTimestampMs =
    typeof item.expiration_timestamp === 'number'
      ? Math.round(item.expiration_timestamp * 1000)
      : null;

  return {
    symbol: canonical,
    exchangeSymbol: item.instrument_name,
    base,
    quote: 'USD',
    settle,
    expiry,
    expirationTimestamp: expirationTimestampMs,
    strike,
    right,
    inverse: false,
    contractSize: 1,
    contractValueCurrency: 'USD',
    tickSize: item.tick_size ?? null,
    minQty: item.min_order_amount ?? item.volume_tick_size ?? null,
    // Thalex fees are tiered per account — FEE_CAP is the safety net.
    makerFee: null,
    takerFee: null,
  };
}
