import type { PositionLeg, StrategyGroup } from '@oggregator/protocol';

import { strategyBias, type StrategyBias } from './strategy-label';

export interface StrategyEntry {
  group: StrategyGroup;
  bias: StrategyBias;
  // When the last leg was opened, i.e. when the structure was complete.
  openedAtMs: number;
  // Underlying at that leg's fill; null when the venue fill anchor is unavailable.
  spotUsd: number | null;
  // Spread between the first and last leg's open time; > 0 means it was legged in.
  leggedOverMs: number;
}

export function strategyEntries(
  groups: readonly StrategyGroup[],
  positions: readonly PositionLeg[],
  underlying: string,
): StrategyEntry[] {
  const byId = new Map(positions.map((p) => [p.legId, p]));
  const entries: StrategyEntry[] = [];
  for (const group of groups) {
    if (group.underlying !== underlying) continue;
    const legs = group.legIds.map((id) => byId.get(id)).filter((l): l is PositionLeg => l != null);
    if (legs.length === 0) continue;
    let last = legs[0]!;
    let firstTs = last.entryTs;
    for (const leg of legs) {
      if (leg.entryTs > last.entryTs) last = leg;
      firstTs = Math.min(firstTs, leg.entryTs);
    }
    entries.push({
      group,
      bias: strategyBias(group),
      openedAtMs: last.entryTs,
      spotUsd: last.entryUnderlyingUsd ?? null,
      leggedOverMs: last.entryTs - firstTs,
    });
  }
  return entries.sort((a, b) => a.openedAtMs - b.openedAtMs);
}

// Index of the candle containing tsMs, or -1 when it predates the loaded range.
export function candleIndexAt(candleTimestampsMs: readonly number[], tsMs: number): number {
  let lo = 0;
  let hi = candleTimestampsMs.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (candleTimestampsMs[mid]! <= tsMs) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}
