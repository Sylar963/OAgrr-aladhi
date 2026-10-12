import { IvHistoryService } from '@oggregator/core';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { TradfiStore } from '../runtime/store.js';
import type { TradfiReadiness } from '../tastytrade/feed.js';

const feed = {
  readiness: (): TradfiReadiness => ({
    catalogLoaded: true, quoteTokenAcquired: true, streaming: true,
    lastDataTs: 1, underlyings: 1, instruments: 1,
  }),
  ensureChainSubscribed: () => {},
  refreshChainQuotes: async () => 0,
};

describe('GET /iv-history', () => {
  it('serves recorded underlyings and rejects the rest', async () => {
    const service = new IvHistoryService(
      { getSurfaceGrid: async () => [] },
      { underlyings: ['SPX'] },
    );
    const app = buildApp({
      store: new TradfiStore(), feed, ivHistory: { service, underlyings: ['SPX'] },
    });

    const list = await app.inject({ method: 'GET', url: '/iv-history/underlyings' });
    expect(list.json()).toEqual({ underlyings: ['SPX'] });

    const res = await app.inject({ method: 'GET', url: '/iv-history?underlying=spx&window=90d&tenor=30d' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ underlying: 'SPX', windowDays: 90 });

    expect((await app.inject({ method: 'GET', url: '/iv-history?underlying=AAPL' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/iv-history' })).statusCode).toBe(400);
    await app.close();
  });

  it('is unavailable when nothing is recording', async () => {
    const app = buildApp({ store: new TradfiStore(), feed });
    expect((await app.inject({ method: 'GET', url: '/iv-history?underlying=SPX' })).statusCode).toBe(503);
    await app.close();
  });
});
