import Fastify from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const spotHealth = {
  connected: true,
  symbols: [],
  lastSuccessAt: Date.now(),
  lastStatusAt: Date.now(),
  errors: 0,
};

const flowHealthRows: Array<{
  venue: string;
  underlying: string;
  connected: boolean;
  lastMessageAt: number | null;
}> = [];

vi.mock('../app.js', () => ({
  SERVER_BOOT_TIME: Date.now(),
  SERVER_VERSION: 'test',
  isReady: () => true,
  isShuttingDown: () => false,
}));

vi.mock('../system-status.js', () => ({
  getSystemAnnouncement: vi.fn(() => null),
}));

vi.mock('../services.js', () => ({
  getIvHistoryStorageStats: vi.fn(() =>
    Promise.resolve({
      enabled: true,
      bytes: 1024,
      thresholdBytes: 10 * 1024 * 1024 * 1024,
      warning: false,
    }),
  ),
  isBlockFlowReady: vi.fn(() => true),
  isDvolReady: vi.fn(() => true),
  isFlowReady: vi.fn(() => true),
  isIvHistoryReady: vi.fn(() => true),
  isNewsReady: vi.fn(() => true),
  isSpotReady: vi.fn(() => true),
  spotService: { getHealth: () => spotHealth },
  flowService: {
    getHealth: () =>
      flowHealthRows.map((row) => ({
        ...row,
        lastTradeAt: row.lastMessageAt,
        lastStatusAt: row.lastMessageAt,
        reconnects: 0,
        errors: 0,
        seedTrades: 0,
        bufferedTrades: 0,
      })),
  },
  blockFlowService: { getHealth: () => [] },
}));

import * as services from '../services.js';
import * as systemStatus from '../system-status.js';
import { healthRoute } from './health.js';

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(healthRoute);
  await app.ready();
  return app;
}

beforeEach(() => {
  spotHealth.connected = true;
  spotHealth.lastSuccessAt = Date.now();
  spotHealth.lastStatusAt = Date.now();
  spotHealth.errors = 0;
  flowHealthRows.length = 0;
});

describe('GET /health', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('includes IV history readiness and storage stats', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });

    expect(res.statusCode).toBe(200);
    expect(res.json().services).toMatchObject({
      ivHistory: true,
      ivHistoryStorage: {
        enabled: true,
        bytes: 1024,
        thresholdBytes: 10 * 1024 * 1024 * 1024,
        warning: false,
      },
    });
  });

  it('includes a runtime metrics snapshot', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });

    expect(res.statusCode).toBe(200);
    expect(res.json().runtime).toMatchObject({
      uptimeSec: expect.any(Number),
      memory: {
        rssMb: expect.any(Number),
        heapUsedMb: expect.any(Number),
        heapTotalMb: expect.any(Number),
      },
      eventLoopLag: {
        p50Ms: expect.any(Number),
        p99Ms: expect.any(Number),
        maxMs: expect.any(Number),
        windowSec: expect.any(Number),
      },
      resources: {
        total: expect.any(Number),
        byType: expect.any(Object),
      },
    });
  });

  it('includes a per-venue feed health summary', async () => {
    flowHealthRows.push({
      venue: 'deribit',
      underlying: 'BTC',
      connected: true,
      lastMessageAt: Date.now() - 1_000,
    });

    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const feeds = res.json().feeds;
    expect(feeds.summary).toMatchObject({
      totalVenues: expect.any(Number),
      connectedVenues: expect.any(Number),
      lastAnyMessageAgeMs: expect.any(Number),
    });
    expect(feeds.venues.find((v: { venue: string }) => v.venue === 'deribit')).toMatchObject({
      sources: ['flow'],
      connected: true,
    });
  });

  it('surfaces IV history storage warnings', async () => {
    vi.mocked(services.getIvHistoryStorageStats).mockResolvedValueOnce({
      enabled: true,
      bytes: 11 * 1024 * 1024 * 1024,
      thresholdBytes: 10 * 1024 * 1024 * 1024,
      warning: true,
    });

    const res = await app.inject({ method: 'GET', url: '/health' });

    expect(res.statusCode).toBe(200);
    expect(res.json().services.ivHistoryStorage).toMatchObject({
      bytes: 11 * 1024 * 1024 * 1024,
      warning: true,
    });
  });

  it('returns a null announcement when none is set', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json().announcement).toBeNull();
  });

  it('includes the system announcement when present', async () => {
    vi.mocked(systemStatus.getSystemAnnouncement).mockReturnValueOnce({
      id: 'm1',
      severity: 'notice',
      blocking: false,
      title: 'Under construction',
    });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json().announcement).toMatchObject({ id: 'm1', severity: 'notice' });
  });
});

describe('GET /ready', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 200 when bootstrap is complete and feeds are fresh', async () => {
    const res = await app.inject({ method: 'GET', url: '/ready' });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('ok');
  });

  it('returns 503 with status=stale when all feeds are silent past the threshold', async () => {
    const tenMinAgo = Date.now() - 10 * 60 * 1000;
    spotHealth.lastSuccessAt = tenMinAgo;
    flowHealthRows.push({
      venue: 'deribit',
      underlying: 'BTC',
      connected: true,
      lastMessageAt: tenMinAgo,
    });

    const res = await app.inject({ method: 'GET', url: '/ready' });
    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body.status).toBe('stale');
    expect(body.lastAnyMessageAgeMs).toBeGreaterThan(300_000);
  });

  it('returns 503 with status=initializing while bootstrap is incomplete', async () => {
    // currentReadinessStatus + isTrafficReady both read isSpotReady, so a
    // single-use mock would flip back mid-handler. Use the persistent override
    // and restore explicitly.
    vi.mocked(services.isSpotReady).mockReturnValue(false);
    try {
      const res = await app.inject({ method: 'GET', url: '/ready' });
      expect(res.statusCode).toBe(503);
      expect(res.json().status).toBe('initializing');
    } finally {
      vi.mocked(services.isSpotReady).mockReturnValue(true);
    }
  });
});
