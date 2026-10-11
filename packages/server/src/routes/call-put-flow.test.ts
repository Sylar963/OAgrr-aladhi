import Fastify from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { bucketCallPutMock, storeState } = vi.hoisted(() => ({
  bucketCallPutMock: vi.fn(),
  storeState: { enabled: true },
}));

vi.mock('../services.js', () => ({
  tradeStore: {
    get enabled() {
      return storeState.enabled;
    },
    bucketCallPut: bucketCallPutMock,
  },
}));

import { callPutFlowRoute, clearCallPutFlowCache, toCallPutFlowBuckets } from './call-put-flow.js';

describe('toCallPutFlowBuckets', () => {
  it('pivots per-type rows into one bucket per timestamp', () => {
    const buckets = toCallPutFlowBuckets([
      {
        bucketTs: new Date(3_600_000),
        optionType: 'put',
        count: 2,
        contracts: 1.5,
        premiumUsd: 300,
        notionalUsd: 120_000,
      },
      {
        bucketTs: new Date(0),
        optionType: 'call',
        count: 1,
        contracts: 2,
        premiumUsd: 500,
        notionalUsd: 160_000,
      },
      {
        bucketTs: new Date(3_600_000),
        optionType: 'call',
        count: 4,
        contracts: 3,
        premiumUsd: 900,
        notionalUsd: 240_000,
      },
    ]);

    expect(buckets).toEqual([
      {
        ts: 0,
        callCount: 1,
        putCount: 0,
        callContracts: 2,
        putContracts: 0,
        callNotionalUsd: 160_000,
        putNotionalUsd: 0,
        callPremiumUsd: 500,
        putPremiumUsd: 0,
      },
      {
        ts: 3600,
        callCount: 4,
        putCount: 2,
        callContracts: 3,
        putContracts: 1.5,
        callNotionalUsd: 240_000,
        putNotionalUsd: 120_000,
        callPremiumUsd: 900,
        putPremiumUsd: 300,
      },
    ]);
  });
});

describe('GET /flow/call-put-buckets', () => {
  const app = Fastify({ logger: false });

  beforeAll(async () => {
    await app.register(callPutFlowRoute);
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    bucketCallPutMock.mockReset();
    bucketCallPutMock.mockResolvedValue([]);
    clearCallPutFlowCache();
    storeState.enabled = true;
  });

  it('reads the full aligned window once and trims it to each lookback', async () => {
    bucketCallPutMock.mockImplementation(async (query: { endTs: Date }) => [
      {
        bucketTs: new Date(query.endTs.getTime() - 3600_000),
        optionType: 'call',
        count: 1,
        contracts: 1,
        premiumUsd: 1,
        notionalUsd: 1,
      },
      {
        bucketTs: new Date(query.endTs.getTime() - 20 * 86_400_000),
        optionType: 'put',
        count: 1,
        contracts: 1,
        premiumUsd: 1,
        notionalUsd: 1,
      },
    ]);

    const week = await app.inject({
      method: 'GET',
      url: '/flow/call-put-buckets?underlying=btc&resolution=3600&days=7',
    });
    const month = await app.inject({
      method: 'GET',
      url: '/flow/call-put-buckets?underlying=btc&resolution=3600&days=30',
    });

    expect(week.statusCode).toBe(200);
    const body = week.json();
    expect(body).toMatchObject({ available: true, underlying: 'BTC', resolution: 3600 });
    expect(body.end % 3600).toBe(0);
    expect(body.end - body.start).toBe(7 * 86_400);
    expect(body.buckets).toHaveLength(1);
    expect(month.json().buckets).toHaveLength(2);
    expect(bucketCallPutMock).toHaveBeenCalledTimes(1);
    expect(bucketCallPutMock).toHaveBeenCalledWith({
      mode: 'live',
      underlying: 'BTC',
      startTs: new Date((body.end - 90 * 86_400) * 1000),
      endTs: new Date(body.end * 1000),
      resolutionSec: 3600,
    });
  });

  it('rejects unsupported resolutions and windows', async () => {
    const badResolution = await app.inject({
      method: 'GET',
      url: '/flow/call-put-buckets?resolution=60',
    });
    const badDays = await app.inject({ method: 'GET', url: '/flow/call-put-buckets?days=365' });

    expect(badResolution.statusCode).toBe(400);
    expect(badDays.statusCode).toBe(400);
  });

  it('reports unavailable without touching the store when persistence is off', async () => {
    storeState.enabled = false;
    const res = await app.inject({ method: 'GET', url: '/flow/call-put-buckets' });

    expect(res.json()).toMatchObject({ available: false, buckets: [] });
    expect(bucketCallPutMock).not.toHaveBeenCalled();
  });
});
