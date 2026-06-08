import type { LiveQuote } from '../shared/sdk-base.js';
import type { ParadexMarket, ParadexSummary } from './types.js';

export interface ParadexInstrumentDetails {
  base: string;
  settle: string;
  right: 'call' | 'put';
  strike: number;
  expiryRaw: string; // unix ms as string — fed to SdkBaseAdapter.parseExpiry()
  expirationTimestampMs: number | null;
  tickRaw: string | null | undefined;
  stepRaw: string | null | undefined;
  makerFeeRaw: string | null | undefined;
  takerFeeRaw: string | null | undefined;
}

/** Parse a Paradex /markets entry into option fields. Returns null for non-options. */
export function paradexInstrumentDetails(market: ParadexMarket): ParadexInstrumentDetails | null {
  if (market.asset_kind !== 'OPTION') return null;
  const strike = Number(market.strike_price);
  if (!Number.isFinite(strike)) return null;
  if (market.expiry_at == null) return null;
  const right = market.option_type === 'CALL' ? 'call' : market.option_type === 'PUT' ? 'put' : null;
  if (right == null) return null;

  return {
    base: market.base_currency,
    settle: market.settlement_currency ?? 'USDC',
    right,
    strike,
    expiryRaw: String(market.expiry_at),
    expirationTimestampMs: market.expiry_at,
    tickRaw: market.price_tick_size,
    stepRaw: market.order_size_increment,
    makerFeeRaw: market.fee_config?.api_fee?.maker_fee?.fee,
    takerFeeRaw: market.fee_config?.api_fee?.taker_fee?.fee,
  };
}

/** Map a Paradex markets-summary payload (REST element OR WS params.data) into a LiveQuote. */
export function buildParadexQuote(
  summary: ParadexSummary,
  safeNum: (v: unknown) => number | null,
  positiveOrNull: (v: unknown) => number | null,
): LiveQuote {
  const g = summary.greeks;
  return {
    bidPrice: positiveOrNull(summary.bid),
    askPrice: positiveOrNull(summary.ask),
    bidSize: positiveOrNull(summary.bid_size),
    askSize: positiveOrNull(summary.ask_size),
    markPrice: safeNum(summary.mark_price),
    lastPrice: positiveOrNull(summary.last_traded_price), // '' → null
    underlyingPrice: safeNum(summary.underlying_price),
    indexPrice: safeNum(summary.underlying_price), // no discrete index field
    volume24h: null, // only USD volume is exposed
    openInterest: safeNum(summary.open_interest), // base currency; base derives USD
    openInterestUsd: null,
    volume24hUsd: safeNum(summary.volume_24h), // already USD
    greeks: {
      delta: safeNum(g?.delta),
      gamma: safeNum(g?.gamma),
      theta: safeNum(g?.theta),
      vega: safeNum(g?.vega),
      rho: safeNum(g?.rho),
      markIv: safeNum(summary.mark_iv), // FRACTION already — no ivToFraction
      bidIv: safeNum(summary.bid_iv),
      askIv: safeNum(summary.ask_iv),
    },
    timestamp: summary.created_at ?? Date.now(),
  };
}
