import Fastify from 'fastify';
import type { PersistedTradeRecord } from '@oggregator/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { loadHistoryMock, storeState } = vi.hoisted(() => ({
  loadHistoryMock: vi.fn(),
  storeState: { enabled: true },
}));

vi.mock('../services.js', () => ({
  tradeStore: {
    get enabled() {
      return storeState.enabled;
    },
    loadHistory: loadHistoryMock,
  },
}));

import {
  aggregateBlockStrikeBuckets,
  blockStrikeBucketsRoute,
  clearBlockStrikeBucketsCache,
} from './block-strike-buckets.js';

function record(overrides: Partial<PersistedTradeRecord> = {}): PersistedTradeRecord {
  return {
    tradeUid: 'uid-1',
    mode: 'institutional',
    venue: 'deribit',
    underlying: 'BTC',
    instrumentName: 'BTC-30OCT26-80000-C',
    tradeTs: new Date('2026-10-09T03:20:00Z'),
    ingestedAt: new Date('2026-10-09T03:20:01Z'),
    direction: 'buy',
    contracts: 10,
    price: null,
    premiumUsd: null,
    notionalUsd: null,
    referencePriceUsd: 80_000,
    expiry: '2026-10-30',
    strike: 80_000,
    optionType: 'call',
    iv: null,
    markPrice: null,
    isBlock: true,
    strategyLabel: null,
    legs: null,
    raw: {},
    ...overrides,
  };
}

describe('aggregateBlockStrikeBuckets', () => {
  it('splits multi-leg blocks into per-strike legs and applies the venue multiplier', () => {
    const buckets = aggregateBlockStrikeBuckets(
      [
        record({
          venue: 'okx',
          instrumentName: 'BTC-USD-261009-85000-P',
          legs: [
            { instrument: 'BTC-USD-261009-85000-P', direction: 'buy', price: 0.03, size: 100, ratio: 1 },
            { instrument: 'BTC-USD-261016-83000-P', direction: 'sell', price: 0.02, size: 100, ratio: 1 },
          ],
        }),
      ],
      3600,
    );

    expect(buckets).toEqual([
      {
        ts: Date.parse('2026-10-09T03:00:00Z') / 1000,
        strike: 83_000,
        expiry: '2026-10-16',
        callContracts: 0,
        putContracts: 1,
        callNotionalUsd: 0,
        putNotionalUsd: 80_000,
        legs: 1,
      },
      {
        ts: Date.parse('2026-10-09T03:00:00Z') / 1000,
        strike: 85_000,
        expiry: '2026-10-09',
        callContracts: 0,
        putContracts: 1,
        callNotionalUsd: 0,
        putNotionalUsd: 80_000,
        legs: 1,
      },
    ]);
  });

  it('sums trades landing in the same candle, strike, and expiry', () => {
    const buckets = aggregateBlockStrikeBuckets(
      [
        record({ tradeUid: 'a', tradeTs: new Date('2026-10-09T03:05:00Z') }),
        record({ tradeUid: 'b', tradeTs: new Date('2026-10-09T03:55:00Z'), contracts: 5 }),
        record({
          tradeUid: 'c',
          tradeTs: new Date('2026-10-09T04:01:00Z'),
          instrumentName: 'BTC-30OCT26-80000-P',
        }),
      ],
      3600,
    );

    expect(buckets).toHaveLength(2);
    expect(buckets[0]).toMatchObject({ callContracts: 15, callNotionalUsd: 1_200_000, legs: 2 });
    expect(buckets[1]).toMatchObject({
      ts: Date.parse('2026-10-09T04:00:00Z') / 1000,
      putContracts: 10,
    });
  });

  it('keeps contracts but zero notional when the reference price is missing', () => {
    const [bucket] = aggregateBlockStrikeBuckets([record({ referencePriceUsd: null })], 3600);
    expect(bucket).toMatchObject({ callContracts: 10, callNotionalUsd: 0 });
  });

  it('skips legs without a parseable strike or option type', () => {
    expect(
      aggregateBlockStrikeBuckets([record({ instrumentName: 'BTC-PERPETUAL' })], 3600),
    ).toEqual([]);
  });
});

describe('GET /block-flow/strike-buckets', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  async function buildApp() {
    const instance = Fastify({ logger: false });
    await instance.register(blockStrikeBucketsRoute);
    await instance.ready();
    return instance;
  }

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    storeState.enabled = true;
    loadHistoryMock.mockReset();
    clearBlockStrikeBucketsCache();
  });

  const url =
    '/block-flow/strike-buckets?underlying=btc&resolution=3600&start=2026-10-08T00:00:00Z&end=2026-10-09T05:00:00Z';

  it('rejects unsupported resolutions and oversized windows', async () => {
    const badRes = await app.inject({
      method: 'GET',
      url: '/block-flow/strike-buckets?resolution=7&start=2026-10-08T00:00:00Z',
    });
    expect(badRes.statusCode).toBe(400);

    const tooWide = await app.inject({
      method: 'GET',
      url: '/block-flow/strike-buckets?resolution=3600&start=2020-01-01T00:00:00Z&end=2026-10-09T00:00:00Z',
    });
    expect(tooWide.statusCode).toBe(400);
  });

  it('reports unavailable when the trade store is disabled', async () => {
    storeState.enabled = false;
    const res = await app.inject({ method: 'GET', url });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ available: false, buckets: [] });
    expect(loadHistoryMock).not.toHaveBeenCalled();
  });

  it('pages institutional history across the window and aggregates it', async () => {
    const fullPage = Array.from({ length: 1000 }, (_, i) =>
      record({ tradeUid: `p1-${i}`, tradeTs: new Date('2026-10-09T03:30:00Z') }),
    );
    loadHistoryMock
      .mockResolvedValueOnce(fullPage)
      .mockResolvedValueOnce([record({ tradeUid: 'p2-0', tradeTs: new Date('2026-10-08T01:10:00Z') })]);

    const res = await app.inject({ method: 'GET', url });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ available: true, underlying: 'BTC', resolution: 3600, truncated: false });
    expect(body.buckets).toHaveLength(2);
    expect(body.buckets[1]).toMatchObject({ callContracts: 10_000, legs: 1000 });

    expect(loadHistoryMock).toHaveBeenCalledTimes(2);
    expect(loadHistoryMock.mock.calls[0]![0]).toMatchObject({
      mode: 'institutional',
      underlying: 'BTC',
      startTs: new Date('2026-10-08T00:00:00Z'),
      endTs: new Date('2026-10-09T05:00:00Z'),
      limit: 1000,
    });
    expect(loadHistoryMock.mock.calls[1]![0]).toMatchObject({
      beforeTs: new Date('2026-10-09T03:30:00Z'),
      beforeUid: 'p1-999',
    });
  });

  it('serves repeat requests from cache', async () => {
    loadHistoryMock.mockResolvedValue([record()]);
    await app.inject({ method: 'GET', url });
    await app.inject({ method: 'GET', url });
    expect(loadHistoryMock).toHaveBeenCalledTimes(1);
  });
});
