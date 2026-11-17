import type { EquityHistoryPoint, ExchangePortfolioTrade, LinearPosition, PositionLeg } from '@oggregator/protocol';

import { naturalKeyOf } from '../../portfolio/position-fold.js';
import {
  ParadexJwtClaimsSchema,
  type ParadexAccountHistory,
  type ParadexJwtClaims,
  type ParadexPosition,
  type ParadexFill,
} from './types.js';

const MONTHS: Record<string, string> = {
  JAN: '01',
  FEB: '02',
  MAR: '03',
  APR: '04',
  MAY: '05',
  JUN: '06',
  JUL: '07',
  AUG: '08',
  SEP: '09',
  OCT: '10',
  NOV: '11',
  DEC: '12',
};

// Option markets are BASE-QUOTE-DDMONYY-STRIKE-C|P; decimal strikes use `_` (167_5 = 167.5).
export function parseParadexOptionSymbol(symbol: string): {
  underlying: string;
  expiry: string;
  strike: number;
  optionRight: 'call' | 'put';
} | null {
  const parts = symbol.split('-');
  if (parts.length !== 5) return null;
  const [underlying, , dateRaw, strikeRaw, rightRaw] = parts;
  if (!underlying || !dateRaw || !strikeRaw || !rightRaw) return null;
  const date = /^(\d{1,2})([A-Z]{3})(\d{2})$/.exec(dateRaw);
  const month = date == null ? undefined : MONTHS[date[2]!];
  if (date == null || month == null) return null;
  const strike = Number(strikeRaw.replace('_', '.'));
  if (!Number.isFinite(strike) || strike <= 0) return null;
  const optionRight = rightRaw === 'C' ? 'call' : rightRaw === 'P' ? 'put' : null;
  if (optionRight == null) return null;
  return {
    underlying,
    expiry: `20${date[3]}-${month}-${date[1]!.padStart(2, '0')}`,
    strike,
    optionRight,
  };
}

function finiteOrNull(raw: string | undefined): number | null {
  if (raw == null || raw === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export function paradexPositionToLeg(
  pos: ParadexPosition,
  nowMs: number = Date.now(),
): PositionLeg | null {
  if (pos.status !== 'OPEN') return null;
  const parsed = parseParadexOptionSymbol(pos.market);
  if (parsed == null) return null;
  const size = finiteOrNull(pos.size);
  if (size == null || size === 0) return null;
  const entryPriceUsd = finiteOrNull(pos.average_entry_price_usd ?? pos.average_entry_price);
  if (entryPriceUsd == null || entryPriceUsd <= 0) return null;

  // Positions carry no mark; back it out of the venue's own unrealized P&L so the
  // portfolio total matches what Paradex shows.
  const unrealized = finiteOrNull(pos.unrealized_pnl);
  const funding = finiteOrNull(pos.unrealized_funding_pnl) ?? 0;
  const mark = unrealized == null ? null : entryPriceUsd + (unrealized - funding) / size;
  const venueMarkPriceUsd = mark != null && mark >= 0 ? mark : null;

  return {
    legId: naturalKeyOf({ ...parsed, source: 'paradex' }),
    ...parsed,
    size,
    entryPriceUsd,
    entryIv: null,
    realizedPnlUsd: finiteOrNull(pos.realized_positional_pnl) ?? 0,
    entryTs: pos.created_at ?? nowMs,
    venueHint: 'paradex',
    source: 'paradex',
    venueMarkPriceUsd,
    venueMarkTs: venueMarkPriceUsd == null ? null : nowMs,
  };
}

export function paradexPositionsToLegs(
  positions: ParadexPosition[],
  nowMs: number = Date.now(),
): PositionLeg[] {
  return positions.flatMap((pos) => {
    const leg = paradexPositionToLeg(pos, nowMs);
    return leg == null ? [] : [leg];
  });
}

export function formatParadexOptionSymbol(leg: Pick<PositionLeg, 'underlying' | 'expiry' | 'strike' | 'optionRight'>): string {
  const [year, month, day] = leg.expiry.split('-');
  const monthName = Object.keys(MONTHS).find((key) => MONTHS[key] === month);
  if (year == null || day == null || monthName == null) throw new Error('Invalid option expiry');
  return `${leg.underlying}-USD-${Number(day)}${monthName}${year.slice(2)}-${String(leg.strike).replace('.', '_')}-${leg.optionRight === 'call' ? 'C' : 'P'}`;
}

export function paradexPositionsToLinear(positions: ParadexPosition[]): LinearPosition[] {
  return positions.flatMap((pos): LinearPosition[] => {
    const symbol = /^([A-Z0-9]+)-USD-PERP$/.exec(pos.market);
    if (pos.status !== 'OPEN' || symbol == null) return [];
    const size = finiteOrNull(pos.size);
    const entry = finiteOrNull(pos.average_entry_price_usd ?? pos.average_entry_price);
    if (size == null || size === 0 || entry == null || entry <= 0) return [];
    const unrealized = finiteOrNull(pos.unrealized_pnl);
    const funding = finiteOrNull(pos.unrealized_funding_pnl) ?? 0;
    const mark = unrealized == null ? null : entry + (unrealized - funding) / size;
    return [{
      instrumentName: pos.market, underlying: symbol[1]!, kind: 'perpetual', expiry: null,
      sizeCoin: size, entryPriceUsd: entry,
      markPriceUsd: mark != null && Number.isFinite(mark) && mark >= 0 ? mark : null,
      source: 'paradex',
    }];
  });
}

export function paradexFillToTrade(fill: ParadexFill): ExchangePortfolioTrade | null {
  const parsed = parseParadexOptionSymbol(fill.market);
  if (parsed == null) return null;
  const amount = finiteOrNull(fill.size);
  const price = finiteOrNull(fill.price);
  if (amount == null || amount <= 0 || price == null || price < 0) {
    throw new Error('Invalid Paradex option fill price or size');
  }
  const underlying = finiteOrNull(fill.underlying_price);
  return {
    venue: 'paradex', tradeId: fill.id, orderId: fill.order_id ?? null, groupId: null,
    instrumentName: fill.market, ...parsed, direction: fill.side === 'BUY' ? 'buy' : 'sell',
    amount, priceUsd: price,
    feeUsd: ['USD', 'USDC', 'USDT'].includes(fill.fee_currency ?? '') ? finiteOrNull(fill.fee) : null,
    realizedPnlUsd: finiteOrNull(fill.realized_pnl),
    liquidityRole: fill.liquidity === 'MAKER' ? 'maker' : fill.liquidity === 'TAKER' ? 'taker' : null,
    timestampMs: fill.created_at,
    underlyingPriceUsd: underlying != null && underlying > 0 ? underlying : null,
  };
}

export function decodeParadexJwtClaims(token: string): ParadexJwtClaims | null {
  const payload = token.split('.')[1];
  if (payload == null) return null;
  try {
    const json: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const parsed = ParadexJwtClaimsSchema.safeParse(json);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

// The account-history docs leave the timestamp unit unspecified.
function paradexTimestampMs(ts: number): number {
  return Math.round(ts < 1e12 ? ts * 1000 : ts);
}

export function paradexAccountHistoryToPoints(history: ParadexAccountHistory): EquityHistoryPoint[] {
  const points: EquityHistoryPoint[] = [];
  const count = Math.min(history.data.length, history.timestamps.length);
  for (let i = 0; i < count; i += 1) {
    const equityUsd = history.data[i]!;
    if (Number.isFinite(equityUsd)) points.push({ ts: paradexTimestampMs(history.timestamps[i]!), equityUsd });
  }
  return points.sort((a, b) => a.ts - b.ts);
}
