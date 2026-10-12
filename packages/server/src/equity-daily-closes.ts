import type { EquityHistoryPoint } from '@oggregator/protocol';

const DAY_MS = 86_400_000;

/** Last point of each UTC day, oldest first. */
export function toDailyCloses(points: readonly EquityHistoryPoint[]): EquityHistoryPoint[] {
  const byDay = new Map<number, EquityHistoryPoint>();
  for (const point of [...points].sort((a, b) => a.ts - b.ts)) {
    byDay.set(Math.floor(point.ts / DAY_MS), point);
  }
  return [...byDay.values()];
}
