import type { Fill } from './fill.js';
import type { UsdAmount } from './money.js';
import type { Position } from './position.js';

export interface FillEconomics {
  underlying: string;
  expiry: string;
  strike: number;
  optionRight: 'call' | 'put';
  premiumCashFlowUsd: UsdAmount;
  feesUsd: UsdAmount;
}

export interface PositionMark {
  key: Position['key'];
  markPriceUsd: number | null;
}

export interface PositionPnl {
  key: Position['key'];
  netQuantity: number;
  avgEntryPriceUsd: UsdAmount;
  markPriceUsd: number | null;
  unrealizedUsd: UsdAmount | null;
  realizedUsd: UsdAmount;
  feesUsd: UsdAmount;
  totalUsd: UsdAmount | null;
}

export interface PnlSnapshot {
  positions: PositionPnl[];
  cashUsd: UsdAmount;
  realizedUsd: UsdAmount;
  unrealizedUsd: UsdAmount;
  feesUsd: UsdAmount;
  totalUsd: UsdAmount;
  equityUsd: UsdAmount;
  generatedAt: Date;
}

export function instrumentKey(input: {
  underlying: string;
  expiry: string;
  strike: number;
  optionRight: 'call' | 'put';
}): string {
  return `${input.underlying}|${input.expiry}|${input.strike}|${input.optionRight}`;
}

export function aggregateFillEconomics(fills: Fill[]): FillEconomics[] {
  const byInstrument = new Map<string, FillEconomics>();
  for (const fill of fills) {
    const key = instrumentKey(fill);
    const current = byInstrument.get(key) ?? {
      underlying: fill.underlying,
      expiry: fill.expiry,
      strike: fill.strike,
      optionRight: fill.optionRight,
      premiumCashFlowUsd: 0,
      feesUsd: 0,
    };
    const premiumSign = fill.side === 'sell' ? 1 : -1;
    current.premiumCashFlowUsd += premiumSign * fill.priceUsd * fill.quantity;
    current.feesUsd += fill.feesUsd;
    byInstrument.set(key, current);
  }
  return [...byInstrument.values()];
}

export function computePositionPnl(
  pos: Position,
  mark: number | null,
  economics?: FillEconomics,
): PositionPnl {
  const unrealized = mark != null ? pos.netQuantity * (mark - pos.avgEntryPriceUsd) : null;
  const feesUsd = economics?.feesUsd ?? 0;
  const realizedUsd = economics
    ? economics.premiumCashFlowUsd + pos.netQuantity * pos.avgEntryPriceUsd - feesUsd
    : pos.realizedPnlUsd;
  return {
    key: pos.key,
    netQuantity: pos.netQuantity,
    avgEntryPriceUsd: pos.avgEntryPriceUsd,
    markPriceUsd: mark,
    unrealizedUsd: unrealized,
    realizedUsd,
    feesUsd,
    totalUsd: unrealized != null ? realizedUsd + unrealized : null,
  };
}

export function computeSnapshot(
  positions: Position[],
  marks: Map<string, number | null>,
  cashUsd: UsdAmount,
  now: Date,
  economics: FillEconomics[] = [],
): PnlSnapshot {
  const economicsByInstrument = new Map(economics.map((row) => [instrumentKey(row), row]));
  const rows = positions.map((p) => {
    const markKey = instrumentKey(p.key);
    const mark = marks.get(markKey) ?? null;
    return computePositionPnl(p, mark, economicsByInstrument.get(markKey));
  });
  const unrealized = rows.reduce((sum, r) => sum + (r.unrealizedUsd ?? 0), 0);
  const positionKeys = new Set(positions.map((position) => instrumentKey(position.key)));
  const unprojectedRealized = economics.reduce(
    (sum, row) =>
      positionKeys.has(instrumentKey(row)) ? sum : sum + row.premiumCashFlowUsd - row.feesUsd,
    0,
  );
  const realized = rows.reduce((sum, r) => sum + r.realizedUsd, unprojectedRealized);
  const feesUsd = economics.reduce((sum, row) => sum + row.feesUsd, 0);
  const inventoryValue = rows.reduce((sum, r) => sum + r.netQuantity * (r.markPriceUsd ?? 0), 0);
  return {
    positions: rows,
    cashUsd,
    realizedUsd: realized,
    unrealizedUsd: unrealized,
    feesUsd,
    totalUsd: realized + unrealized,
    equityUsd: cashUsd + inventoryValue,
    generatedAt: now,
  };
}
