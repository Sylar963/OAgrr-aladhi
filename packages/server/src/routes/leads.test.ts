import Fastify from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { captureLeadMock, leadsStore } = vi.hoisted(() => {
  const captureLeadMock = vi.fn();
  return {
    captureLeadMock,
    leadsStore: { enabled: true, captureLead: captureLeadMock, dispose: vi.fn() },
  };
});

vi.mock('../services.js', () => ({ leadsStore }));

import { leadsRoute } from './leads.js';

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(leadsRoute);
  await app.ready();
  return app;
}

describe('POST /leads', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    captureLeadMock.mockReset();
    leadsStore.enabled = true;
  });

  it('persists a valid lead and returns 201', async () => {
    captureLeadMock.mockResolvedValue({
      id: 'lead_1',
      email: 'desk@fund.com',
      source: 'hero',
      createdAt: new Date(),
    });
    const res = await app.inject({
      method: 'POST',
      url: '/leads',
      payload: { email: 'desk@fund.com', source: 'hero' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ ok: true });
    expect(captureLeadMock).toHaveBeenCalledWith({ email: 'desk@fund.com', source: 'hero' });
  });

  it('rejects an invalid payload with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/leads',
      payload: { email: 'not-an-email', source: '' },
    });
    expect(res.statusCode).toBe(400);
    expect(captureLeadMock).not.toHaveBeenCalled();
  });

  it('returns 503 when persistence is unavailable', async () => {
    leadsStore.enabled = false;
    const res = await app.inject({
      method: 'POST',
      url: '/leads',
      payload: { email: 'desk@fund.com', source: 'hero' },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: 'persistence_unavailable' });
  });
});
