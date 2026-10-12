import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';

const { deriveMock, thalexMock, paradexMock } = vi.hoisted(() => ({
  deriveMock: { fetchEquityHistory: vi.fn() },
  thalexMock: { fetchEquityHistory: vi.fn() },
  paradexMock: { fetchEquityHistory: vi.fn() },
}));

vi.mock('../../derive-position-store.js', () => ({ derivePositionStore: deriveMock }));
vi.mock('../../thalex-position-store.js', () => ({ thalexPositionStore: thalexMock }));
vi.mock('../../paradex-position-store.js', () => ({ paradexPositionStore: paradexMock }));
vi.mock('../../user-service.js', () => ({
  getRequestAccountId: (req: { headers: Record<string, string | undefined> }, fallback: string) =>
    req.headers['x-account'] ?? fallback,
}));

import { portfolioEquityHistoryRoute, sliceRange, toDailyCloses } from './equity-history.js';

const DAY_MS = 86_400_000;

describe('equity history helpers', () => {
  it('keeps the last point of each UTC day', () => {
    const day = Date.UTC(2026, 9, 10);
    expect(
      toDailyCloses([
        { ts: day + DAY_MS + 5, equityUsd: 3 },
        { ts: day + 1, equityUsd: 1 },
        { ts: day + 2, equityUsd: 2 },
      ]),
    ).toEqual([
      { ts: day + 2, equityUsd: 2 },
      { ts: day + DAY_MS + 5, equityUsd: 3 },
    ]);
  });

  it('slices to the requested range', () => {
    const now = Date.UTC(2026, 9, 12);
    const points = [
      { ts: now - 60 * DAY_MS, equityUsd: 1 },
      { ts: now - 10 * DAY_MS, equityUsd: 2 },
    ];
    expect(sliceRange(points, '1M', now)).toEqual([points[1]]);
    expect(sliceRange(points, '3M', now)).toEqual(points);
  });
});

describe('GET /portfolio/equity-history', () => {
  const app = Fastify();
  let account = 0;
  const nextAccount = () => `acct-${(account += 1)}`;

  beforeAll(async () => {
    await app.register(portfolioEquityHistoryRoute);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    deriveMock.fetchEquityHistory.mockReset();
    thalexMock.fetchEquityHistory.mockReset();
    paradexMock.fetchEquityHistory.mockReset();
  });

  it('returns 409 when the venue is not signed in for the account', async () => {
    thalexMock.fetchEquityHistory.mockResolvedValue(null);
    const res = await app.inject({
      method: 'GET',
      url: '/portfolio/equity-history?venue=thalex&range=1M',
      headers: { 'x-account': nextAccount() },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('venue_not_connected');
  });

  it('fetches 3M once and serves both ranges from the cache', async () => {
    const now = Date.now();
    deriveMock.fetchEquityHistory.mockResolvedValue([
      { ts: now - 60 * DAY_MS, equityUsd: 900 },
      { ts: now - 5 * DAY_MS, equityUsd: 1_000 },
    ]);
    const headers = { 'x-account': nextAccount() };

    const oneMonth = await app.inject({ method: 'GET', url: '/portfolio/equity-history?venue=derive&range=1M', headers });
    const threeMonth = await app.inject({ method: 'GET', url: '/portfolio/equity-history?venue=derive&range=3M', headers });

    expect(oneMonth.statusCode).toBe(200);
    expect(oneMonth.json()).toMatchObject({ venue: 'derive', range: '1M', basis: 'venue_value' });
    expect(oneMonth.json().points).toHaveLength(1);
    expect(threeMonth.json().points).toHaveLength(2);
    expect(deriveMock.fetchEquityHistory).toHaveBeenCalledTimes(1);
    const fromMs = deriveMock.fetchEquityHistory.mock.calls[0]![1] as number;
    expect(now - fromMs).toBeGreaterThanOrEqual(90 * DAY_MS - 1_000);
  });

  it('labels Thalex as a cash replay and maps venue errors to 502', async () => {
    thalexMock.fetchEquityHistory.mockResolvedValueOnce([{ ts: Date.now(), equityUsd: 5 }]);
    const ok = await app.inject({
      method: 'GET',
      url: '/portfolio/equity-history?venue=thalex',
      headers: { 'x-account': nextAccount() },
    });
    expect(ok.json()).toMatchObject({ range: '1M', basis: 'cash_replay' });

    paradexMock.fetchEquityHistory.mockRejectedValueOnce(new Error('boom'));
    const failed = await app.inject({
      method: 'GET',
      url: '/portfolio/equity-history?venue=paradex',
      headers: { 'x-account': nextAccount() },
    });
    expect(failed.statusCode).toBe(502);
  });

  it('rejects venues without equity history', async () => {
    const res = await app.inject({ method: 'GET', url: '/portfolio/equity-history?venue=deribit' });
    expect(res.statusCode).toBe(400);
  });
});
