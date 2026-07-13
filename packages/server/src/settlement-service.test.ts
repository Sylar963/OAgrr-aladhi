import type { GateioSettlementResult } from '@oggregator/core';
import type { PaperSettlementPriceRow } from '@oggregator/db';
import type { FastifyBaseLogger } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchGateioSettlement: vi.fn<
    (args: { underlying: string; expiry: string }) => Promise<GateioSettlementResult | null>
  >(async () => null),
  getSettlementPrice: vi.fn<
    (underlying: string, expiry: string) => Promise<PaperSettlementPriceRow | null>
  >(async () => null),
  upsertSettlementPrice: vi.fn<(row: PaperSettlementPriceRow) => Promise<void>>(async () => {}),
  getSnapshot: vi.fn<(underlying: string) => { lastPrice: number } | null>(() => null),
}));

vi.mock('@oggregator/core', () => ({
  fetchGateioSettlement: mocks.fetchGateioSettlement,
}));

vi.mock('./trading-services.js', () => ({
  paperTradingStore: {
    enabled: true,
    getSettlementPrice: mocks.getSettlementPrice,
    upsertSettlementPrice: mocks.upsertSettlementPrice,
    listAllAccountIdsWithOpenPositions: vi.fn(async () => []),
  },
}));

vi.mock('./services.js', () => ({
  spotService: { getSnapshot: mocks.getSnapshot },
}));

vi.mock('./routes/paper/workspace.js', () => ({
  settleExpiredPositionsForAccount: vi.fn(),
}));

const { resolveSettlementSpot } = await import('./settlement-service.js');

const log = { info: vi.fn(), warn: vi.fn() } as unknown as FastifyBaseLogger;
const asOf = new Date('2026-04-25T08:05:00.000Z');
const spotFallback: PaperSettlementPriceRow = {
  underlying: 'BTC',
  expiry: '2026-04-25',
  priceUsd: 92_000,
  source: 'spot-runtime',
  capturedAt: asOf,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetchGateioSettlement.mockResolvedValue(null);
  mocks.getSettlementPrice.mockResolvedValue(null);
  mocks.getSnapshot.mockReturnValue(null);
});

describe('resolveSettlementSpot', () => {
  it('returns a cached official settlement without another venue request', async () => {
    mocks.getSettlementPrice.mockResolvedValue({ ...spotFallback, source: 'gateio' });

    const price = await resolveSettlementSpot('BTC', '2026-04-25', asOf, log);

    expect(price).toBe(92_000);
    expect(mocks.fetchGateioSettlement).not.toHaveBeenCalled();
  });

  it('replaces a cached spot fallback when an official settlement becomes available', async () => {
    const capturedAt = new Date('2026-04-25T08:00:00.000Z');
    mocks.getSettlementPrice.mockResolvedValue(spotFallback);
    mocks.fetchGateioSettlement.mockResolvedValue({
      priceUsd: 93_000,
      capturedAt,
      sampleContract: 'BTC_USDT-20260425-90000-C',
    });

    const price = await resolveSettlementSpot('BTC', '2026-04-25', asOf, log);

    expect(price).toBe(93_000);
    expect(mocks.upsertSettlementPrice).toHaveBeenCalledWith({
      underlying: 'BTC',
      expiry: '2026-04-25',
      priceUsd: 93_000,
      source: 'gateio',
      capturedAt,
    });
  });

  it('reuses a cached spot fallback while the official settlement is unavailable', async () => {
    mocks.getSettlementPrice.mockResolvedValue(spotFallback);

    const price = await resolveSettlementSpot('BTC', '2026-04-25', asOf, log);

    expect(price).toBe(92_000);
    expect(mocks.getSnapshot).not.toHaveBeenCalled();
    expect(mocks.upsertSettlementPrice).not.toHaveBeenCalled();
  });

  it('stores current spot only when no cached or official settlement exists', async () => {
    mocks.getSnapshot.mockReturnValue({ lastPrice: 91_500 });

    const price = await resolveSettlementSpot('BTC', '2026-04-25', asOf, log);

    expect(price).toBe(91_500);
    expect(mocks.upsertSettlementPrice).toHaveBeenCalledWith({
      underlying: 'BTC',
      expiry: '2026-04-25',
      priceUsd: 91_500,
      source: 'spot-runtime',
      capturedAt: asOf,
    });
  });
});
