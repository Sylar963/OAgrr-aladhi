import type { FlowStrikeMapBucket } from '@oggregator/protocol';
import type { InstrumentRow } from './chart-queries';
import type { HistoryRange } from './queries';

export type OptionFilter = 'all' | 'call' | 'put';

export interface StrikeFlowProfile {
  strike: number;
  callBuy: number;
  callSell: number;
  callCount: number;
  callInstrument: string | null;
  putBuy: number;
  putSell: number;
  putCount: number;
  putInstrument: string | null;
}

export function buildStrikeFlowProfile(
  buckets: readonly FlowStrikeMapBucket[],
): StrikeFlowProfile[] {
  const rows = new Map<number, StrikeFlowProfile>();
  const instrumentTotals = new Map<string, { count: number; notionalUsd: number }>();
  for (const bucket of buckets) {
    const row = rows.get(bucket.strike) ?? {
      strike: bucket.strike,
      callBuy: 0,
      callSell: 0,
      callCount: 0,
      callInstrument: null,
      putBuy: 0,
      putSell: 0,
      putCount: 0,
      putInstrument: null,
    };
    const countKey = `${bucket.strike}|${bucket.optionType}|${bucket.instrument}`;
    const current = instrumentTotals.get(countKey) ?? { count: 0, notionalUsd: 0 };
    current.count += bucket.count;
    current.notionalUsd += bucket.notionalUsd;
    instrumentTotals.set(countKey, current);
    if (bucket.optionType === 'call') {
      row.callCount += bucket.count;
      if (bucket.side === 'buy') row.callBuy += bucket.notionalUsd;
      else row.callSell += bucket.notionalUsd;
    } else {
      row.putCount += bucket.count;
      if (bucket.side === 'buy') row.putBuy += bucket.notionalUsd;
      else row.putSell += bucket.notionalUsd;
    }
    rows.set(bucket.strike, row);
  }
  for (const bucket of buckets) {
    const row = rows.get(bucket.strike);
    if (row == null) continue;
    const key = `${bucket.strike}|${bucket.optionType}|${bucket.instrument}`;
    const selectedName = bucket.optionType === 'call' ? row.callInstrument : row.putInstrument;
    const bucketTotal = instrumentTotals.get(key);
    const selectedTotal =
      selectedName == null
        ? null
        : instrumentTotals.get(`${bucket.strike}|${bucket.optionType}|${selectedName}`);
    if (
      selectedName == null ||
      (bucketTotal != null &&
        (selectedTotal == null ||
          bucketTotal.count > selectedTotal.count ||
          (bucketTotal.count === selectedTotal.count && bucketTotal.notionalUsd > selectedTotal.notionalUsd)))
    ) {
      if (bucket.optionType === 'call') row.callInstrument = bucket.instrument;
      else row.putInstrument = bucket.instrument;
    }
  }
  return [...rows.values()].sort((left, right) => left.strike - right.strike);
}

export function defaultExpiry(instruments: readonly InstrumentRow[]): string | null {
  const totals = new Map<string, number>();
  for (const instrument of instruments) {
    if (instrument.expiry == null) continue;
    totals.set(instrument.expiry, (totals.get(instrument.expiry) ?? 0) + instrument.count);
  }
  return [...totals.entries()].sort(
    ([leftExpiry, leftCount], [rightExpiry, rightCount]) =>
      rightCount - leftCount || leftExpiry.localeCompare(rightExpiry),
  )[0]?.[0] ?? null;
}

export function flowResolution(range: HistoryRange): number {
  if (!range.start || !range.end) return 900;
  const durationMs = new Date(range.end).getTime() - new Date(range.start).getTime();
  if (durationMs <= 2 * 86_400_000) return 900;
  if (durationMs <= 7 * 86_400_000) return 3600;
  if (durationMs <= 30 * 86_400_000) return 14_400;
  return 86_400;
}

export function flowRangeIsSupported(range: HistoryRange): boolean {
  if (!range.start || !range.end) return false;
  const durationMs = new Date(range.end).getTime() - new Date(range.start).getTime();
  return durationMs > 0 && durationMs <= 90 * 86_400_000;
}

export function optionTypeFromInstrument(instrument: string): 'call' | 'put' | null {
  const match = instrument.match(/-([CP])(?:-|$)/);
  return match?.[1] === 'C' ? 'call' : match?.[1] === 'P' ? 'put' : null;
}

export function formatMoney(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '$0';
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 10_000) return `$${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1)}K`;
  return `$${Math.round(value).toLocaleString('en-US')}`;
}

export function formatExpiry(expiry: string): string {
  const date = new Date(`${expiry}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) return expiry;
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit', timeZone: 'UTC' }).toUpperCase();
}
