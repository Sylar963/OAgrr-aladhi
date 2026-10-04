import type { PersistedGexWallSnapshot } from '@oggregator/db';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildGexWallPoint,
  GEX_WALL_SLOT_MS,
  GexWallHistoryService,
  type GexWallInputs,
  nextSampleDelay,
  slotStart,
} from './gex-wall-history-service.js';

const DAY_MS = 86_400_000;
const SLOT = GEX_WALL_SLOT_MS;
const GEX = [
  { strike: 55_000, gexUsdMillions: -40 },
  { strike: 57_500, gexUsdMillions: -85 },
  { strike: 60_000, gexUsdMillions: -30 },
  { strike: 62_500, gexUsdMillions: 20 },
  { strike: 65_000, gexUsdMillions: 55 },
  { strike: 67_500, gexUsdMillions: 30 },
  { strike: 70_000, gexUsdMillions: 120 },
  { strike: 75_000, gexUsdMillions: 15 },
];

function makeService(
  getInputs: (underlying: string) => Promise<GexWallInputs>,
  now: () => number,
  stored: PersistedGexWallSnapshot[] = [],
) {
  const writes: PersistedGexWallSnapshot[] = [];
  const store = {
    loadSince: vi.fn(async (since: Date) => stored.filter((row) => row.slotTs >= since)),
    writeMany: vi.fn(async (rows: PersistedGexWallSnapshot[]) => {
      writes.push(...rows);
    }),
  };
  const log = { debug: vi.fn(), warn: vi.fn() };
  const service = new GexWallHistoryService({
    underlyings: ['BTC', 'ETH', 'HYPE'],
    store,
    getInputs,
    now,
    log,
  });
  return { service, store, writes, log };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('slot alignment', () => {
  it('floors timestamps to the 15-minute grid', () => {
    const base = 1_700_000_100_000 - (1_700_000_100_000 % SLOT);
    expect(slotStart(base)).toBe(base);
    expect(slotStart(base + SLOT - 1)).toBe(base);
    expect(slotStart(base + SLOT)).toBe(base + SLOT);
  });

  it('schedules the next sample just after the next boundary', () => {
    const base = 100 * SLOT;
    expect(nextSampleDelay(base + 60_000)).toBe(SLOT - 60_000 + 5_000);
    expect(nextSampleDelay(base + 2_000)).toBe(3_000);
    expect(nextSampleDelay(base + 5_000)).toBe(SLOT);
  });
});

describe('buildGexWallPoint', () => {
  it('skips samples with no gex or no spot', () => {
    expect(buildGexWallPoint(0, { spotPrice: null, gex: GEX })).toBeNull();
    expect(buildGexWallPoint(0, { spotPrice: Number.NaN, gex: GEX })).toBeNull();
    expect(buildGexWallPoint(0, { spotPrice: 61_800, gex: [] })).toBeNull();
  });

  it('computes walls for a valid profile', () => {
    const point = buildGexWallPoint(SLOT, { spotPrice: 61_800, gex: GEX });
    expect(point).toMatchObject({ ts: SLOT, spot: 61_800, callWall: 70_000, putWall: 57_500 });
    expect(point?.gammaFlip).toBeCloseTo(68_541.67, 1);
  });
});

describe('GexWallHistoryService', () => {
  it('records one aligned row per underlying per slot and skips empty inputs', async () => {
    let now = 1_000 * SLOT + 7 * 60_000;
    const getInputs = vi.fn(async (underlying: string): Promise<GexWallInputs> => {
      if (underlying === 'HYPE') return { spotPrice: null, gex: [] };
      return { spotPrice: 61_800, gex: GEX };
    });
    const { service, writes, log } = makeService(getInputs, () => now);

    await service.sampleAll();
    await service.sampleAll();

    expect(writes.map((row) => [row.underlying, row.slotTs.getTime()])).toEqual([
      ['BTC', 1_000 * SLOT],
      ['ETH', 1_000 * SLOT],
    ]);
    expect(getInputs).toHaveBeenCalledTimes(4);
    expect(log.debug).toHaveBeenCalled();

    now += SLOT;
    await service.sampleAll();
    expect(service.query('btc', 1).points.map((point) => point.ts)).toEqual([
      1_000 * SLOT,
      1_001 * SLOT,
    ]);
    expect(service.query('HYPE', 1)).toEqual({ underlying: 'HYPE', resolutionSec: 900, points: [] });
  });

  it('does not let one underlying failure stop the others', async () => {
    const now = 500 * SLOT;
    const { service, writes, log } = makeService(async (underlying) => {
      if (underlying === 'BTC') throw new Error('venue down');
      return { spotPrice: 3_000, gex: [{ strike: 3_200, gexUsdMillions: 5 }] };
    }, () => now);

    await expect(service.sampleAll()).resolves.toBeUndefined();
    expect(writes.map((row) => row.underlying)).toEqual(['ETH', 'HYPE']);
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ underlying: 'BTC' }),
      'GEX-wall sample failed',
    );
  });

  it('hydrates once on start, serves the window from memory, and samples on an unref timer', async () => {
    vi.useFakeTimers();
    const now = 3_000 * SLOT + 60_000;
    vi.setSystemTime(now);
    const stored: PersistedGexWallSnapshot[] = [
      { underlying: 'BTC', slotTs: new Date(now - 40 * DAY_MS), spot: 1, callWall: null, putWall: null, gammaFlip: null },
      { underlying: 'BTC', slotTs: new Date(now - 2 * DAY_MS), spot: 2, callWall: 3, putWall: 1, gammaFlip: 2 },
    ];
    const getInputs = vi.fn(async (): Promise<GexWallInputs> => ({ spotPrice: 61_800, gex: GEX }));
    const { service, store } = makeService(getInputs, Date.now, stored);

    await service.start();
    expect(store.loadSince).toHaveBeenCalledTimes(1);
    expect(service.query('BTC', 30).points).toEqual([
      { ts: now - 2 * DAY_MS, spot: 2, callWall: 3, putWall: 1, gammaFlip: 2 },
    ]);
    expect(service.query('BTC', 90).points).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(getInputs).toHaveBeenCalledTimes(3);
    expect(service.query('BTC', 1).points.at(-1)?.ts).toBe(3_000 * SLOT);

    await vi.advanceTimersByTimeAsync(SLOT);
    expect(getInputs).toHaveBeenCalledTimes(6);
    expect(store.loadSince).toHaveBeenCalledTimes(1);

    service.dispose();
    await vi.advanceTimersByTimeAsync(2 * SLOT);
    expect(getInputs).toHaveBeenCalledTimes(6);
  });
});
