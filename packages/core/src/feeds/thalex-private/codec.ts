import type { EquityHistoryPoint, ExchangePortfolioTrade, PositionLeg } from '@oggregator/protocol';

import { naturalKeyOf } from '../../portfolio/position-fold.js';
import { THALEX_OPTION_SYMBOL_RE } from '../thalex/types.js';
import type {
  ThalexAccountSummary,
  ThalexDailyMark,
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

const NUM_TO_MONTH = Object.fromEntries(Object.entries(MONTH_TO_NUM).map(([mon, num]) => [num, mon]));

/** Inverse of `parseThalexOptionInstrument`: BTC-23OCT26-84000-C. */
export function formatThalexOptionInstrument(leg: {
  underlying: string;
  expiry: string;
  strike: number;
  optionRight: 'call' | 'put';
}): string | null {
  const [year, month, day] = leg.expiry.split('-');
  const mon = month != null ? NUM_TO_MONTH[month] : undefined;
  if (year == null || mon == null || day == null) return null;
  const right = leg.optionRight === 'call' ? 'C' : 'P';
  return `${leg.underlying.toUpperCase()}-${day}${mon}${year.slice(2)}-${leg.strike}-${right}`;
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
const SETTLEMENT_OFFSET_MS = 8 * 3_600_000;
// Settlement transactions are stamped a little after 08:00 UTC; inside this window they still
// belong to that morning's settlement.
const SETTLEMENT_WINDOW_MS = 3_600_000;
const SETTLEMENT_TRANSACTION_TYPES = new Set(['session settlement', 'perpetual funding']);

/** The latest 08:00 UTC session settlement at or before `ms`. */
export function thalexSettlementBoundary(ms: number): number {
  return Math.floor((ms - SETTLEMENT_OFFSET_MS) / DAY_MS) * DAY_MS + SETTLEMENT_OFFSET_MS;
}

function settledAtMs(tx: ThalexTransaction): number {
  const ms = tx.time * 1000;
  if (tx.transaction_type == null || !SETTLEMENT_TRANSACTION_TYPES.has(tx.transaction_type)) return ms;
  const boundary = thalexSettlementBoundary(ms);
  return ms - boundary <= SETTLEMENT_WINDOW_MS ? boundary : ms;
}

// Session P&L, realised or not, only reaches cash at the 08:00 UTC settlement.
function unsettledPnl(summary: ThalexAccountSummary): number {
  return summary.unrealised_pnl + (summary.session_realised_pnl ?? 0);
}

// Thalex settles every product futures-style each session, so right after the 08:00 UTC
// settlement cash is the whole equity. Walks the current balances back through the
// transaction log and samples each settlement; non-stable assets use today's index.
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

  const newestFirst = transactions
    .map((tx) => ({ tx, at: settledAtMs(tx) }))
    .sort((a, b) => b.at - a.at);
  const points: EquityHistoryPoint[] = [
    { ts: nowMs, equityUsd: cashValue() + unsettledPnl(summary) },
  ];
  let cursor = 0;
  for (let boundary = thalexSettlementBoundary(nowMs); boundary >= fromMs; boundary -= DAY_MS) {
    while (cursor < newestFirst.length && newestFirst[cursor]!.at > boundary) {
      const { tx } = newestFirst[cursor]!;
      const balance = balances.get(tx.asset);
      if (balance != null) balances.set(tx.asset, balance - tx.amount);
      cursor += 1;
    }
    if (boundary < nowMs) points.push({ ts: boundary, equityUsd: cashValue() });
  }
  return points.reverse();
}

export interface ThalexCashHolding {
  asset: string;
  balance: number;
  indexPriceUsd: number | null;
  valueUsd: number | null;
}

export interface ThalexAccountEquity {
  cash: ThalexCashHolding[];
  cashUsd: number;
  /** Cash plus the session's unsettled P&L: unrealised and session-realised. */
  equityUsd: number;
  unrealisedPnlUsd: number;
  sessionRealisedPnlUsd: number | null;
  marginUsd: number | null;
  requiredMarginUsd: number | null;
  remainingMarginUsd: number | null;
  updatedAt: number;
}

export function thalexAccountEquity(summary: ThalexAccountSummary, nowMs: number): ThalexAccountEquity {
  const cash = summary.cash.map((row) => {
    const price = THALEX_STABLE_ASSETS.has(row.currency) ? 1 : (row.collateral_index_price ?? null);
    const indexPriceUsd = price != null && Number.isFinite(price) ? price : null;
    return {
      asset: row.currency,
      balance: row.balance,
      indexPriceUsd,
      valueUsd: indexPriceUsd == null ? null : row.balance * indexPriceUsd,
    };
  });
  const cashUsd = cash.reduce((total, row) => total + (row.valueUsd ?? 0), 0);
  return {
    cash,
    cashUsd,
    equityUsd: cashUsd + unsettledPnl(summary),
    unrealisedPnlUsd: summary.unrealised_pnl,
    sessionRealisedPnlUsd: summary.session_realised_pnl ?? null,
    marginUsd: summary.margin ?? null,
    requiredMarginUsd: summary.required_margin ?? null,
    remainingMarginUsd: summary.remaining_margin ?? null,
    updatedAt: nowMs,
  };
}

export interface ThalexCashTransaction {
  ts: number;
  type: string | null;
  asset: string;
  amount: number;
  instrument: string | null;
  balanceAfter: number | null;
  description: string | null;
}

export function thalexCashTransactions(transactions: readonly ThalexTransaction[]): ThalexCashTransaction[] {
  return [...transactions]
    .sort((a, b) => b.time - a.time)
    .map((tx) => ({
      ts: Math.round(tx.time * 1000),
      type: tx.transaction_type ?? null,
      asset: tx.asset,
      amount: tx.amount,
      instrument: tx.instrument_name ?? null,
      balanceAfter: tx.balance_after ?? null,
      description: tx.description ?? null,
    }));
}

export interface ThalexRealizedPnlInput {
  dailyMarks: readonly ThalexDailyMark[];
  trades: readonly ExchangePortfolioTrade[];
  entries: readonly ThalexPortfolioEntry[];
  underlying?: string;
}

// Realised option P&L against average cost, so realised plus (mark − average_price) × size
// adds up to the account's total P&L. Thalex books P&L against a start price that resets to
// the mark at every settlement: the daily marks hold every settled session, fills after the
// last mark hold this session's closes, and (average_price − start_price) × position takes
// back the part of still-open legs that settlements already paid out. Null when an open leg
// lacks either price.
export function thalexRealizedPnl({
  dailyMarks,
  trades,
  entries,
  underlying,
}: ThalexRealizedPnlInput): number | null {
  const inScope = (instrumentName: string) => {
    const parsed = parseThalexOptionInstrument(instrumentName);
    return parsed != null && (underlying == null || parsed.underlying === underlying);
  };
  let total = 0;
  let settledThroughMs = 0;
  for (const mark of dailyMarks) {
    settledThroughMs = Math.max(settledThroughMs, mark.time * 1000);
    if (inScope(mark.instrument_name)) total += mark.realized_position_pnl;
  }
  for (const trade of trades) {
    if (trade.timestampMs <= settledThroughMs) continue;
    if (underlying != null && trade.underlying !== underlying) continue;
    total += trade.realizedPnlUsd ?? 0;
  }
  for (const entry of entries) {
    if (entry.position === 0 || !inScope(entry.instrument_name)) continue;
    const average = entry.average_price;
    const start = entry.start_price;
    if (average == null || start == null || !Number.isFinite(average) || !Number.isFinite(start)) {
      return null;
    }
    total += (average - start) * entry.position;
  }
  return total;
}

export interface ThalexAccountMargin {
  initialMarginUsd: number;
  marginUsd: number;
  remainingMarginUsd: number;
  updatedAt: number;
}

export function thalexAccountMargin(
  summary: ThalexAccountSummary,
  nowMs: number,
): ThalexAccountMargin | null {
  const { margin, required_margin: required, remaining_margin: remaining } = summary;
  if (margin == null || required == null || remaining == null) return null;
  if (![margin, required, remaining].every(Number.isFinite)) return null;
  return {
    initialMarginUsd: required,
    marginUsd: margin,
    remainingMarginUsd: remaining,
    updatedAt: nowMs,
  };
}
