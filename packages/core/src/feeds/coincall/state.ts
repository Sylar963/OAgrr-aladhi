import type { CachedInstrument, LiveQuote } from '../shared/sdk-base.js';
import type { OptionRight } from '../../types/common.js';
import {
  COINCALL_OPTION_SYMBOL_RE,
  type CoincallBsInfoData,
  type CoincallInstrument,
  type CoincallOptionConfigEntry,
  type CoincallTOptionEntry,
} from './types.js';

function mergeNumber(next: number | undefined | null, previous: number | null): number | null {
  return next ?? previous;
}

/**
 * bsInfo delivers markPrice / iv / greeks / oi / underlyingPrice.
 * No bid/ask fields — those come from tOption (see mergeCoincallTOption).
 */
export function mergeCoincallBsInfo(
  data: CoincallBsInfoData,
  previous: LiveQuote | undefined,
  empty: LiveQuote,
): LiveQuote {
  const base = previous ?? empty;
  return {
    bidPrice: base.bidPrice,
    askPrice: base.askPrice,
    bidSize: base.bidSize,
    askSize: base.askSize,
    markPrice: mergeNumber(data.mp, base.markPrice),
    lastPrice: mergeNumber(data.lp, base.lastPrice),
    underlyingPrice: mergeNumber(data.up, base.underlyingPrice),
    indexPrice: mergeNumber(data.ip, base.indexPrice),
    volume24h: mergeNumber(data.v24, base.volume24h),
    openInterest: mergeNumber(data.oi, base.openInterest),
    openInterestUsd: base.openInterestUsd,
    volume24hUsd: mergeNumber(data.uv24, base.volume24hUsd),
    greeks: {
      delta: mergeNumber(data.delta, base.greeks.delta),
      gamma: mergeNumber(data.gamma, base.greeks.gamma),
      theta: mergeNumber(data.theta, base.greeks.theta),
      vega: mergeNumber(data.vega, base.greeks.vega),
      rho: base.greeks.rho,
      markIv: mergeNumber(data.iv, base.greeks.markIv),
      bidIv: base.greeks.bidIv,
      askIv: base.greeks.askIv,
    },
    timestamp: data.ts,
  };
}

/**
 * tOption delivers per-contract bid/ask/bs/as/biv/aiv plus greeks.
 * Overlays previous quote so markIv (set by bsInfo) survives.
 */
export function mergeCoincallTOption(
  entry: CoincallTOptionEntry,
  previous: LiveQuote | undefined,
  empty: LiveQuote,
): LiveQuote {
  const base = previous ?? empty;
  return {
    bidPrice: mergeNumber(entry.bid, base.bidPrice),
    askPrice: mergeNumber(entry.ask, base.askPrice),
    bidSize: mergeNumber(entry.bs, base.bidSize),
    askSize: mergeNumber(entry.as, base.askSize),
    markPrice: mergeNumber(entry.mp, base.markPrice),
    lastPrice: mergeNumber(entry.lp, base.lastPrice),
    underlyingPrice: mergeNumber(entry.up, base.underlyingPrice),
    indexPrice: base.indexPrice,
    volume24h: mergeNumber(entry.v24, base.volume24h),
    openInterest: mergeNumber(entry.oi, base.openInterest),
    openInterestUsd: base.openInterestUsd,
    volume24hUsd: base.volume24hUsd,
    greeks: {
      delta: mergeNumber(entry.delta, base.greeks.delta),
      gamma: mergeNumber(entry.gamma, base.greeks.gamma),
      theta: mergeNumber(entry.theta, base.greeks.theta),
      vega: mergeNumber(entry.vega, base.greeks.vega),
      rho: base.greeks.rho,
      markIv: base.greeks.markIv,
      bidIv: mergeNumber(entry.biv, base.greeks.bidIv),
      askIv: mergeNumber(entry.aiv, base.greeks.askIv),
    },
    timestamp: entry.ts,
  };
}

export interface CoincallInstrumentDeps {
  buildCanonicalSymbol: (
    base: string,
    settle: string,
    expiry: string,
    strike: number,
    right: OptionRight,
  ) => string;
  parseExpiry: (raw: string) => string;
}

export function buildCoincallInstrument(
  item: CoincallInstrument,
  optionConfig: Record<string, CoincallOptionConfigEntry>,
  deps: CoincallInstrumentDeps,
): CachedInstrument | null {
  if (!item.isActive) return null;

  const match = COINCALL_OPTION_SYMBOL_RE.exec(item.symbolName);
  if (!match) return null;

  const base = match[1]!;
  const expiryToken = match[2]!;
  const strike = Number(match[3]!);
  const right: OptionRight = match[4] === 'C' ? 'call' : 'put';
  if (!Number.isFinite(strike)) return null;

  // Coincall gives two sources of truth for expiry: the DDMMMYY token in the
  // native symbol and `expirationTimestamp` (ms). Prefer the symbol token
  // because that's how the venue keys every downstream subscription;
  // timestamp is a fallback when the token isn't parseable (shouldn't happen
  // given the regex guard).
  const expiry = deps.parseExpiry(expiryToken);

  // optionConfig is keyed by pair (BTCUSD), not by base (BTC).
  const cfg = optionConfig[`${base}USD`] ?? null;
  const settle = cfg?.settle ?? 'USD';
  const multiplier = cfg?.multiplier ?? 1;
  const canonical = deps.buildCanonicalSymbol(base, settle, expiry, strike, right);

  return {
    symbol: canonical,
    exchangeSymbol: item.symbolName,
    base,
    quote: 'USD',
    settle,
    expiry,
    strike,
    right,
    inverse: false,
    contractSize: multiplier,
    contractValueCurrency: 'USD',
    tickSize: cfg?.tickSize ?? item.tickSize,
    minQty: cfg?.minQty ?? item.minQty,
    makerFee: cfg?.makerFee ?? null,
    takerFee: cfg?.takerFee ?? null,
  };
}

