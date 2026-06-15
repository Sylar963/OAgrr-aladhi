import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';

vi.mock('@oggregator/core', () => ({
  getAllAdapters: vi.fn(() => [
    {
      venue: 'deribit',
      listUnderlyings: vi.fn(async () => [
        'BTC',
        'BTC_USDC',
        'ETH',
        'ETH_USDC',
        'AVAX_USDC',
        'SOL_USDC',
        'XRP_USDC',
      ]),
    },
    {
      venue: 'bybit',
      listUnderlyings: vi.fn(async () => ['BTC', 'ETH', 'SOL', 'XRP']),
    },
  ]),
}));

import { underlyingsRoute } from './underlyings.js';

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(underlyingsRoute);
  await app.ready();
  return app;
}

describe('GET /underlyings', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('collapses alias-only families but keeps true sibling products distinct', async () => {
    const res = await app.inject({ method: 'GET', url: '/underlyings' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      underlyings: ['AVAX', 'BTC', 'BTC_USDC', 'ETH', 'ETH_USDC', 'SOL', 'XRP'],
      byVenue: [
        {
          venue: 'deribit',
          underlyings: ['AVAX', 'BTC', 'BTC_USDC', 'ETH', 'ETH_USDC', 'SOL', 'XRP'],
        },
        { venue: 'bybit', underlyings: ['BTC', 'ETH', 'SOL', 'XRP'] },
      ],
    });
  });
});
