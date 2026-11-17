import type { OptionsActivity, OptionsActivitySide } from '@oggregator/protocol';
import { fmtUsdCompact } from '@lib/format';

export type ActivityMetric = 'volume' | 'oi';
export type ActivityUnit = 'contracts' | 'usd';
const NUMBER = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

export function activityValue(side: OptionsActivitySide, metric: ActivityMetric, unit: ActivityUnit): number | null {
  if (unit === 'usd') return metric === 'volume' ? side.volumeNotionalUsd : side.oiNotionalUsd;
  return metric === 'volume' ? side.volume : side.openInterest;
}

export function sumValues(a: number | null, b: number | null): number | null {
  return a == null && b == null ? null : (a ?? 0) + (b ?? 0);
}

export function totalActivity(activity: OptionsActivity, metric: ActivityMetric, unit: ActivityUnit): number | null {
  return sumValues(activityValue(activity.call, metric, unit), activityValue(activity.put, metric, unit));
}

export function formatActivity(value: number | null, unit: ActivityUnit): string {
  return unit === 'usd' ? fmtUsdCompact(value) : value == null ? '—' : NUMBER.format(value);
}

export function formatRatio(value: number | null): string {
  return value == null ? '—' : value.toFixed(2);
}

export function coverage(activity: OptionsActivity) {
  return {
    total: activity.call.contracts + activity.put.contracts,
    volume: activity.call.volumeObserved + activity.put.volumeObserved,
    oi: activity.call.oiObserved + activity.put.oiObserved,
  };
}
