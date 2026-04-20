import type { CachedInstrument, LiveQuote } from '../shared/sdk-base.js';
import type { CoincallMarkPrice, CoincallTicker } from './types.js';

export const COINCALL_DEFAULT_MAKER_FEE = 0.0003;
export const COINCALL_DEFAULT_TAKER_FEE = 0.0004;

export function buildCoincallMarkPriceQuote(
  item: CoincallMarkPrice,
  previous: LiveQuote | undefined,
  positiveOrNull: (value: string | undefined) => number | null,
  safeNum: (value: unknown) => number | null,
): LiveQuote {
  const bidPrice = positiveOrNull(item.bidPrice);
  const askPrice = positiveOrNull(item.askPrice);
  const bidIv = positiveOrNull(item.bidIv);
  const askIv = positiveOrNull(item.askIv);

  return {
    bidPrice,
    askPrice,
    bidSize: bidPrice != null ? safeNum(item.bidSize) : null,
    askSize: askPrice != null ? safeNum(item.askSize) : null,
    markPrice: safeNum(item.markPrice),
    lastPrice: previous?.lastPrice ?? null,
    underlyingPrice: safeNum(item.indexPrice),
    indexPrice: safeNum(item.indexPrice),
    volume24h: previous?.volume24h ?? null,
    openInterest: previous?.openInterest ?? null,
    openInterestUsd: previous?.openInterestUsd ?? null,
    volume24hUsd: previous?.volume24hUsd ?? null,
    greeks: {
      delta: safeNum(item.delta),
      gamma: safeNum(item.gamma),
      theta: safeNum(item.theta),
      vega: safeNum(item.vega),
      rho: safeNum(item.rho),
      markIv: previous?.greeks.markIv ?? null,
      bidIv,
      askIv,
    },
    timestamp: item.time ?? Date.now(),
  };
}

export function mergeCoincallTicker(
  previous: LiveQuote,
  ticker: CoincallTicker,
  safeNum: (value: unknown) => number | null,
): LiveQuote {
  return {
    ...previous,
    volume24h: ticker.volume24h != null ? safeNum(ticker.volume24h) : previous.volume24h,
    lastPrice: ticker.lastPrice != null ? safeNum(ticker.lastPrice) : previous.lastPrice,
    markPrice: ticker.markPrice != null ? safeNum(ticker.markPrice) : previous.markPrice,
    indexPrice: ticker.indexPrice != null ? safeNum(ticker.indexPrice) : previous.indexPrice,
    timestamp: Date.now(),
  };
}

export function buildCoincallInstrument(
  item: {
    symbolName: string;
    baseCurrency: string;
    strike: number;
    expirationTimestamp: number;
    isActive: boolean;
    minQty: number;
    tickSize: number;
  },
  config: {
    settle: string;
    contractSize: number | null;
  } | null,
  buildCanonicalSymbol: (
    base: string,
    settle: string,
    expiry: string,
    strike: number,
    right: 'call' | 'put',
  ) => string,
): CachedInstrument | null {
  if (!item.isActive) return null;

  const parts = item.symbolName.match(/^(\w+)-(\d{8})-(\d+)-([CP])$/);
  if (!parts) return null;

  const base = parts[1]!;
  const expiry = new Date(item.expirationTimestamp).toISOString().slice(0, 10);
  const right = parts[4] === 'C' ? ('call' as const) : ('put' as const);
  const strike = item.strike;

  return {
    symbol: buildCanonicalSymbol(base, config?.settle ?? 'USD', expiry, strike, right),
    exchangeSymbol: item.symbolName,
    base,
    quote: config?.settle ?? 'USD',
    settle: config?.settle ?? 'USD',
    expiry,
    strike,
    right,
    inverse: false,
    contractSize: config?.contractSize ?? 1,
    contractValueCurrency: base,
    tickSize: item.tickSize,
    minQty: item.minQty,
    makerFee: COINCALL_DEFAULT_MAKER_FEE,
    takerFee: COINCALL_DEFAULT_TAKER_FEE,
  };
}
