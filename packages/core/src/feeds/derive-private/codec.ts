import type { ExchangePortfolioTrade, PositionLeg } from '@oggregator/protocol';

import { naturalKeyOf } from '../../portfolio/position-fold.js';
import type { DerivePosition, DeriveTrade } from './types.js';

export function parseDeriveOptionInstrument(name: string): {
  underlying: string;
  expiry: string;
  strike: number;
  optionRight: 'call' | 'put';
} | null {
  const parts = name.split('-');
  if (parts.length !== 4) return null;
  const [underlying, dateRaw, strikeRaw, rightRaw] = parts;
  if (!underlying || !dateRaw || !strikeRaw || !rightRaw) return null;
  if (dateRaw.length !== 8) return null;
  const yy = dateRaw.slice(0, 4);
  const mm = dateRaw.slice(4, 6);
  const dd = dateRaw.slice(6, 8);
  const expiry = `${yy}-${mm}-${dd}`;
  const strike = Number(strikeRaw);
  if (!Number.isFinite(strike) || strike <= 0) return null;
  const optionRight = rightRaw.toUpperCase() === 'C' ? 'call' : rightRaw.toUpperCase() === 'P' ? 'put' : null;
  if (optionRight == null) return null;
  return { underlying, expiry, strike, optionRight };
}

export function derivePositionToLeg(pos: DerivePosition): PositionLeg | null {
  if (pos.instrument_type !== 'option') return null;
  const parsed = parseDeriveOptionInstrument(pos.instrument_name);
  if (parsed == null) return null;
  const size = Number(pos.amount);
  if (!Number.isFinite(size) || size === 0) return null;
  const entryPriceUsd = Number(pos.average_price);
  if (!Number.isFinite(entryPriceUsd) || entryPriceUsd <= 0) return null;
  const realizedPnlUsd = Number(pos.realized_pnl ?? 0);
  if (!Number.isFinite(realizedPnlUsd)) return null;


  const legId = naturalKeyOf({
    underlying: parsed.underlying,
    expiry: parsed.expiry,
    strike: parsed.strike,
    optionRight: parsed.optionRight,
    source: 'derive',
  });
  return {
    legId,
    underlying: parsed.underlying,
    expiry: parsed.expiry,
    strike: parsed.strike,
    optionRight: parsed.optionRight,
    size,
    entryPriceUsd,
    entryIv: null,
    realizedPnlUsd,
    entryTs: pos.creation_timestamp,
    venueHint: 'derive',
    source: 'derive',
  };
}

export function derivePositionsToLegs(positions: DerivePosition[]): PositionLeg[] {
  const legs: PositionLeg[] = [];
  for (const pos of positions) {
    const leg = derivePositionToLeg(pos);
    if (leg != null) legs.push(leg);
  }
  return legs;
}

export function deriveTradeToPortfolioTrade(
  trade: DeriveTrade,
): ExchangePortfolioTrade | null {
  const parsed = parseDeriveOptionInstrument(trade.instrument_name);
  if (parsed == null) return null;
  const amount = Math.abs(Number(trade.trade_amount));
  const priceUsd = Number(trade.trade_price);
  const feeUsd = trade.trade_fee == null ? null : Number(trade.trade_fee);
  const realizedPnlUsd = trade.realized_pnl == null ? null : Number(trade.realized_pnl);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  if (!Number.isFinite(priceUsd) || priceUsd < 0) return null;
  if (feeUsd != null && !Number.isFinite(feeUsd)) return null;
  if (realizedPnlUsd != null && !Number.isFinite(realizedPnlUsd)) return null;
  const groupReference = trade.quote_id ?? trade.rfq_id ?? null;
  return {
    venue: 'derive',
    tradeId: trade.trade_id,
    orderId: trade.order_id ?? null,
    groupId: groupReference == null ? null : `derive:${groupReference}`,
    instrumentName: trade.instrument_name,
    ...parsed,
    direction: trade.direction,
    amount,
    priceUsd,
    feeUsd,
    realizedPnlUsd,
    liquidityRole: trade.liquidity_role ?? null,
    timestampMs: trade.timestamp,
  };
}

export function deriveTradesToPortfolioTrades(
  trades: DeriveTrade[],
): ExchangePortfolioTrade[] {
  return trades.flatMap((trade) => {
    const normalized = deriveTradeToPortfolioTrade(trade);
    return normalized == null ? [] : [normalized];
  });
}
