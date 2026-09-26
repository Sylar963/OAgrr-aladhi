import { computeVenueTenorIvs, type SurfaceGridEntry } from '@oggregator/core';
import type { PersistedVenueIvHistoryPoint, VenueIvHistoryStore } from '@oggregator/db';

import { utcHourlySlotMs } from './short-straddle-snapshot-service.js';

const TENOR_DAYS = [7, 30, 60, 90] as const;
const MIN_IV = 0.05;
const MAX_IV = 5;

/**
 * Records one per-venue constant-maturity IV sample per underlying per UTC hour from the
 * surface grid the IV-history loop already builds. The slot is only marked done after a
 * successful write, so a failed write is retried on the next snapshot tick.
 */
export class VenueIvHistoryCollector {
  private readonly writtenSlots = new Map<string, number>();

  constructor(private readonly store: VenueIvHistoryStore) {}

  async collect(entries: SurfaceGridEntry[], underlying: string, now: number = Date.now()): Promise<number> {
    const key = underlying.toUpperCase();
    const slot = utcHourlySlotMs(now);
    if (this.writtenSlots.get(key) === slot) return 0;

    const points: PersistedVenueIvHistoryPoint[] = computeVenueTenorIvs(entries, TENOR_DAYS)
      .filter((point) => Number.isFinite(point.atmIv) && point.atmIv >= MIN_IV && point.atmIv <= MAX_IV)
      .map((point) => ({
        venue: point.venue,
        underlying: key,
        tenorDays: point.tenorDays as PersistedVenueIvHistoryPoint['tenorDays'],
        slotTs: new Date(slot),
        observedAt: new Date(now),
        atmIv: point.atmIv,
        rr25d: point.rr25d,
        bfly25d: point.bfly25d,
      }));
    if (points.length > 0) await this.store.writeMany(points);
    this.writtenSlots.set(key, slot);
    return points.length;
  }
}
