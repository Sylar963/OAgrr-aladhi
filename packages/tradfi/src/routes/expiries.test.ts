import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import type { TradfiDeps } from '../app.js';
import { expiriesRoute } from './expiries.js';

describe('TradFi expiry settlement metadata', () => {
  it('preserves dates and publishes settlement timestamps without rescanning the full catalog', async () => {
    const store = {
      listExpiries: () => ['2026-11-11', '2026-11-12'],
      instrumentsFor: (_underlying: string, expiry: string) =>
        expiry === '2026-11-11' ? [{ expiryTs: 200 }, { expiryTs: 100 }, { expiryTs: NaN }] : [],
    } as unknown as TradfiDeps['store'];
    const app = Fastify();
    await app.register(expiriesRoute({ store } as TradfiDeps));
    const res = await app.inject('/expiries?underlying=SPX');
    expect(res.json()).toEqual({
      underlying: 'SPX',
      expiries: ['2026-11-11', '2026-11-12'],
      timestamps: [
        { expiry: '2026-11-11', expiryTs: 100 },
        { expiry: '2026-11-12', expiryTs: null },
      ],
    });
    expect((await app.inject('/expiries')).statusCode).toBe(400);
    await app.close();
  });
});
