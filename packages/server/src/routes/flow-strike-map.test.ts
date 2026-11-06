import Fastify from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { bucketStrikeFlowMock, listInstrumentsMock, storeState } = vi.hoisted(() => ({
  bucketStrikeFlowMock: vi.fn(),
  listInstrumentsMock: vi.fn(),
  storeState: { enabled: true },
}));

vi.mock('../services.js', () => ({
  tradeStore: {
    get enabled() {
      return storeState.enabled;
    },
    bucketStrikeFlow: bucketStrikeFlowMock,
    listInstruments: listInstrumentsMock,
  },
}));

import { clearFlowStrikeMapCache, flowStrikeMapRoute } from './flow-strike-map.js';

describe('GET /flow/strike-map', () => {
  const app = Fastify({ logger: false });
  const query =
    'underlying=BTC&venue=deribit&expiry=2026-06-30&start=2026-06-30T00%3A00%3A00.000Z&end=2026-06-30T01%3A00%3A00.000Z&resolution=900';

  beforeAll(async () => {
    await app.register(flowStrikeMapRoute);
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    bucketStrikeFlowMock.mockReset();
    bucketStrikeFlowMock.mockResolvedValue([
      {
        bucketTs: new Date('2026-06-30T00:15:00Z'),
        instrument: 'BTC-30JUN26-70000-C',
        expiry: '2026-06-30',
        strike: 70_000,
        optionType: 'call',
        side: 'buy',
        count: 2,
        contracts: 3,
        premiumUsd: 800,
        notionalUsd: 120_000,
      },
      {
        bucketTs: new Date('2026-06-30T00:15:00Z'),
        instrument: 'BTC-30JUN26-70000-P',
        expiry: '2026-06-30',
        strike: 70_000,
        optionType: 'put',
        side: 'sell',
        count: 1,
        contracts: 2,
        premiumUsd: 400,
        notionalUsd: 80_000,
      },
    ]);
    listInstrumentsMock.mockResolvedValue([
      {
        instrument: 'BTC-30JUN26-70000-C',
        count: 2,
        lastTs: new Date('2026-06-30T00:15:00Z'),
        lastTradeUid: '1',
        lastPrice: 0.01,
        lastReferencePriceUsd: 70_000,
        lastIv: 0.55,
        lastIvAt: new Date('2026-06-30T00:15:00Z'),
        optionType: 'call',
        strike: 70_000,
        expiry: '2026-06-30',
      },
    ]);
    storeState.enabled = true;
    clearFlowStrikeMapCache();
  });

  it('returns per-contract buckets, side totals, chart points, and observed IV', async () => {
    const response = await app.inject({ method: 'GET', url: `/flow/strike-map?${query}` });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      available: true,
      underlying: 'BTC',
      venue: 'deribit',
      expiry: '2026-06-30',
      count: 3,
      premiumUsd: 1_200,
      notionalUsd: 200_000,
      buyNotionalUsd: 120_000,
      sellNotionalUsd: 80_000,
      points: [
        { optionType: 'call', side: 'buy', count: 2, notionalUsd: 120_000 },
        { optionType: 'put', side: 'sell', count: 1, notionalUsd: 80_000 },
      ],
      ivPoints: [
        { instrument: 'BTC-30JUN26-70000-C', iv: 0.55, observedAt: Date.parse('2026-06-30T00:15:00Z') },
      ],
      ivCoverageComplete: true,
    });
    expect(bucketStrikeFlowMock).toHaveBeenCalledWith({
      mode: 'live',
      underlying: 'BTC',
      venues: ['deribit'],
      expiry: '2026-06-30',
      startTs: new Date('2026-06-30T00:00:00.000Z'),
      endTs: new Date('2026-06-30T01:00:00.000Z'),
      resolutionSec: 900,
    });
    expect(listInstrumentsMock).toHaveBeenCalledWith(
      expect.objectContaining({ expiry: '2026-06-30', limit: 2_500 }),
    );
  });

  it('rejects windows wider than 90 days', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/flow/strike-map?${query.replace('2026-06-30T01%3A00%3A00.000Z', '2026-10-01T00%3A00%3A00.000Z')}`,
    });

    expect(response.statusCode).toBe(400);
    expect(bucketStrikeFlowMock).not.toHaveBeenCalled();
  });

  it('returns an empty unavailable result without querying storage', async () => {
    storeState.enabled = false;
    const response = await app.inject({ method: 'GET', url: `/flow/strike-map?${query}` });

    expect(response.json()).toMatchObject({ available: false, buckets: [], points: [], ivPoints: [] });
    expect(bucketStrikeFlowMock).not.toHaveBeenCalled();
  });
});
