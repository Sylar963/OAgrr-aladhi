import type { EnrichedStrike, SurfaceGridEntry, VenueQuote } from '@oggregator/core';
import type { PersistedVenueIvHistoryPoint, VenueIvHistoryStore } from '@oggregator/db';
import { describe, expect, it, vi } from 'vitest';

import { VenueIvHistoryCollector } from './venue-iv-history-collector.js';

const HOUR_MS = 3_600_000;
const NOW = Date.parse('2026-09-26T04:05:00.000Z');

function strike(price: number, callDelta: number, iv: number): EnrichedStrike {
  const side = (delta: number) => ({
    venues: { deribit: { markIv: iv, delta } as VenueQuote },
    bestIv: iv,
    bestVenue: 'deribit' as const,
  });
  return { strike: price, call: side(callDelta), put: side(callDelta - 1) };
}

function entry(dte: number, iv: number): SurfaceGridEntry {
  return {
    expiry: `D${dte}`,
    dte,
    strikes: [strike(50_000, 0.75, iv), strike(60_000, 0.5, iv), strike(70_000, 0.25, iv)],
    referencePriceUsd: 60_000,
  } as SurfaceGridEntry;
}

function fakeStore(writeMany = vi.fn(async (_points: PersistedVenueIvHistoryPoint[]) => {})) {
  const store: VenueIvHistoryStore = {
    enabled: true,
    writeMany,
    loadSince: async () => [],
    dispose: async () => {},
  };
  return { store, writeMany };
}

describe('VenueIvHistoryCollector', () => {
  it('writes each bracketed venue tenor once per UTC hour', async () => {
    const { store, writeMany } = fakeStore();
    const collector = new VenueIvHistoryCollector(store);
    const entries = [entry(5, 0.5), entry(40, 0.5)];

    await expect(collector.collect(entries, 'btc', NOW)).resolves.toBe(2);
    await collector.collect(entries, 'BTC', NOW + 30 * 60_000);
    expect(writeMany).toHaveBeenCalledTimes(1);
    expect(writeMany.mock.calls[0]![0].map((p) => [p.venue, p.underlying, p.tenorDays])).toEqual([
      ['deribit', 'BTC', 7],
      ['deribit', 'BTC', 30],
    ]);
    expect(writeMany.mock.calls[0]![0][0]!.slotTs).toEqual(new Date(Date.parse('2026-09-26T04:00:00.000Z')));

    await collector.collect(entries, 'BTC', NOW + HOUR_MS);
    expect(writeMany).toHaveBeenCalledTimes(2);
  });

  it('retries in the same hour after a failed write', async () => {
    const writeMany = vi
      .fn(async (_points: PersistedVenueIvHistoryPoint[]) => {})
      .mockRejectedValueOnce(new Error('db down'));
    const collector = new VenueIvHistoryCollector(fakeStore(writeMany).store);
    const entries = [entry(5, 0.5), entry(40, 0.5)];

    await expect(collector.collect(entries, 'BTC', NOW)).rejects.toThrow('db down');
    await collector.collect(entries, 'BTC', NOW + 5 * 60_000);
    expect(writeMany).toHaveBeenCalledTimes(2);
  });

  it('drops implausible IVs', async () => {
    const { store, writeMany } = fakeStore();
    await new VenueIvHistoryCollector(store).collect([entry(5, 9), entry(40, 9)], 'BTC', NOW);
    expect(writeMany).not.toHaveBeenCalled();
  });
});
