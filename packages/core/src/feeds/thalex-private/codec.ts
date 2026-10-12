import type { EquityHistoryPoint, ExchangePortfolioTrade, PositionLeg } from '@oggregator/protocol';

import { naturalKeyOf } from '../../portfolio/position-fold.js';
import { THALEX_OPTION_SYMBOL_RE } from '../thalex/types.js';
import type {
  ThalexAccountSummary,
  ThalexPortfolioEntry,
  ThalexTrade,
  ThalexTransaction,
} from './types.js';

const MONTH_TO_NUM: Record<string, string> = {
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

export function parseThalexOptionInstrument(name: string): {
  underlying: string;
  expiry: string;
  strike: number;
  optionRight: 'call' | 'put';
} | null {
  const match = THALEX_OPTION_SYMBOL_RE.exec(name);
  if (match == null) return null;
  const [, underlying, dateRaw, strikeRaw, rightRaw] = match;
  if (underlying == null || dateRaw == null || strikeRaw == null || rightRaw == null) return null;

  const dMatch = /^(\d{1,2})([A-Z]{3})(\d{2})$/.exec(dateRaw);
  if (dMatch == null) return null;
  const [, ddRaw, monRaw, yyRaw] = dMatch;
  const mon = MONTH_TO_NUM[monRaw!];
  if (mon == null) return null;
  const dd = ddRaw!.padStart(2, '0');
  const expiry = `20${yyRaw}-${mon}-${dd}`;

  const strike = Number(strikeRaw);
  if (!Number.isFinite(strike) || strike <= 0) return null;

  const optionRight = rightRaw === 'C' ? 'call' : 'put';
  return { underlying, expiry, strike, optionRight };
}

export function thalexPortfolioEntryToLeg(
  entry: ThalexPortfolioEntry,
  nowMs: number = Date.now(),
): PositionLeg | null {
  const parsed = parseThalexOptionInstrument(entry.instrument_name);
  if (parsed == null) return null;
  const size = entry.position;
  if (!Number.isFinite(size) || size === 0) return null;
  const avg = entry.average_price;
  if (avg == null || !Number.isFinite(avg) || avg <= 0) return null;
  const mark = entry.mark_price;
  const venueMarkPriceUsd = mark != null && Number.isFinite(mark) && mark >= 0 ? mark : null;

  const legId = naturalKeyOf({
    underlying: parsed.underlying,
    expiry: parsed.expiry,
    strike: parsed.strike,
    optionRight: parsed.optionRight,
    source: 'thalex',
  });
  return {
    legId,
    underlying: parsed.underlying,
    expiry: parsed.expiry,
    strike: parsed.strike,
    optionRight: parsed.optionRight,
    size,
    entryPriceUsd: avg,
    entryIv: null,
    realizedPnlUsd: 0,
    entryTs: nowMs,
    venueHint: 'thalex',
    source: 'thalex',
    venueMarkPriceUsd,
    venueMarkTs: venueMarkPriceUsd == null ? null : nowMs,
  };
}

export function thalexPortfolioToLegs(
  entries: ThalexPortfolioEntry[],
  nowMs: number = Date.now(),
): PositionLeg[] {
  const legs: PositionLeg[] = [];
  for (const entry of entries) {
    const leg = thalexPortfolioEntryToLeg(entry, nowMs);
    if (leg != null) legs.push(leg);
  }
  return legs;
}

export function thalexTradeToPortfolioTrade(
  trade: ThalexTrade,
): ExchangePortfolioTrade | null {
  const parsed = parseThalexOptionInstrument(trade.instrument_name);
  if (parsed == null) return null;
  if (!Number.isFinite(trade.amount) || trade.amount <= 0) return null;
  if (!Number.isFinite(trade.price) || trade.price < 0) return null;
  const timestampMs = Math.round(trade.time * 1_000);
  if (!Number.isFinite(timestampMs) || timestampMs < 0) return null;
  const orderId = trade.order_id ?? null;
  const grouped =
    orderId != null &&
    (trade.trade_type === 'combo' || trade.trade_type === 'rfq' || (trade.leg_index ?? 0) > 0);
  return {
    venue: 'thalex',
    tradeId: trade.trade_id,
    orderId,
    groupId: grouped ? `thalex:${orderId}` : null,
    instrumentName: trade.instrument_name,
    ...parsed,
    direction: trade.direction,
    amount: trade.amount,
    priceUsd: trade.price,
    feeUsd: trade.fee ?? null,
    realizedPnlUsd: trade.position_pnl ?? null,
    liquidityRole: trade.maker_taker ?? null,
    timestampMs,
  };
}

export function thalexTradesToPortfolioTrades(
  trades: ThalexTrade[],
): ExchangePortfolioTrade[] {
  return trades.flatMap((trade) => {
    const normalized = thalexTradeToPortfolioTrade(trade);
    return normalized == null ? [] : [normalized];
  });
}

const THALEX_STABLE_ASSETS = new Set(['USD', 'USDT', 'USDC']);
const DAY_MS = 86_400_000;

// Thalex settles every product futures-style each session, so settled cash is equity
// up to the open session's unrealised P&L. Walks the current balances back through the
// transaction log and samples each UTC midnight; non-stable assets use today's index.
export function thalexCashReplayEquity(
  summary: ThalexAccountSummary,
  transactions: readonly ThalexTransaction[],
  fromMs: number,
  nowMs: number,
): EquityHistoryPoint[] {
  const prices = new Map<string, number>();
  const balances = new Map<string, number>();
  for (const row of summary.cash) {
    const price = THALEX_STABLE_ASSETS.has(row.currency) ? 1 : row.collateral_index_price;
    if (price == null || !Number.isFinite(price)) continue;
    prices.set(row.currency, price);
    balances.set(row.currency, row.balance);
  }
  const cashValue = () => {
    let total = 0;
    for (const [asset, balance] of balances) total += balance * (prices.get(asset) ?? 0);
    return total;
  };

  const newestFirst = [...transactions].sort((a, b) => b.time - a.time);
  const points: EquityHistoryPoint[] = [
    { ts: nowMs, equityUsd: cashValue() + summary.unrealised_pnl },
  ];
  let cursor = 0;
  for (let boundary = Math.floor(nowMs / DAY_MS) * DAY_MS; boundary >= fromMs; boundary -= DAY_MS) {
    while (cursor < newestFirst.length && newestFirst[cursor]!.time * 1000 > boundary) {
      const tx = newestFirst[cursor]!;
      const balance = balances.get(tx.asset);
      if (balance != null) balances.set(tx.asset, balance - tx.amount);
      cursor += 1;
    }
    if (boundary < nowMs) points.push({ ts: boundary, equityUsd: cashValue() });
  }
  return points.reverse();
}
