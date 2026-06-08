import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const prev = process.env['FUNDED_PROGRAM_ENABLED'];

afterEach(() => {
  if (prev === undefined) delete process.env['FUNDED_PROGRAM_ENABLED'];
  else process.env['FUNDED_PROGRAM_ENABLED'] = prev;
});

describe('funded routes', () => {
  beforeEach(() => {
    process.env['FUNDED_PROGRAM_ENABLED'] = '1';
  });

  it('GET /api/funded/templates returns an array (Noop store -> empty)', async () => {
    const { fundedRoutes } = await import('./index.js');
    const app = Fastify();
    await app.register(fundedRoutes, { prefix: '/api' });
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/api/funded/templates' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ templates: [] });
    await app.close();
  });

  it('returns 404 for funded routes when the flag is off', async () => {
    process.env['FUNDED_PROGRAM_ENABLED'] = '0';
    const { fundedRoutes } = await import('./index.js');
    const app = Fastify();
    await app.register(fundedRoutes, { prefix: '/api' });
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/api/funded/templates' });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
