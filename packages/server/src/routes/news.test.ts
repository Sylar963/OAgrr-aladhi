import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';

const { getItemsMock, pageMock } = vi.hoisted(() => ({ getItemsMock: vi.fn(), pageMock: vi.fn() }));

vi.mock('../services.js', () => ({
  get newsService() {
    return { getItems: getItemsMock };
  },
  get newsArchive() {
    return { page: pageMock };
  },
}));

import { newsRoute } from './news.js';

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(newsRoute);
  await app.ready();
  return app;
}

describe('GET /news', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    getItemsMock.mockReset();
  });

  it('returns items + count', async () => {
    getItemsMock.mockReturnValue([
      {
        id: 'a',
        text: 'hi',
        url: 'https://x.com/a/1',
        source: 'Twitter[t] - @a',
        handle: 'a',
        ruleTag: 't',
        timestamp: 1,
        classification: 'GOOD',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]);

    const res = await app.inject({ method: 'GET', url: '/news' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ count: 1, items: [{ id: 'a' }] });
  });

  it('rejects out-of-range limit', async () => {
    const res = await app.inject({ method: 'GET', url: '/news?limit=999' });
    expect(res.statusCode).toBe(400);
  });

  it('rejects malformed since', async () => {
    const res = await app.inject({ method: 'GET', url: '/news?since=not-a-date' });
    expect(res.statusCode).toBe(400);
  });

  it('forwards since param to runtime', async () => {
    getItemsMock.mockReturnValue([]);
    await app.inject({ method: 'GET', url: '/news?since=2026-01-01T00:00:00.000Z' });
    expect(getItemsMock).toHaveBeenCalledWith({ limit: 50, since: Date.parse('2026-01-01T00:00:00.000Z') });
  });

  it('never echoes the upstream secret in response', async () => {
    getItemsMock.mockReturnValue([
      {
        id: 'a',
        text: 'SECRET_TOKEN should not leak',
        url: 'https://x.com/a/1',
        source: 'Twitter[t] - @a',
        handle: 'a',
        ruleTag: 't',
        timestamp: 1,
        classification: 'GOOD',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]);

    const res = await app.inject({ method: 'GET', url: '/news' });
    expect(res.headers).not.toMatchObject({ 'x-op-secret': expect.anything() });
    expect(res.body).not.toMatch(/op[-_]?secret/i);
  });
});

describe('GET /news/archive', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    pageMock.mockReset();
    pageMock.mockResolvedValue({ items: [], nextCursor: null });
  });

  it('defaults to the latest window', async () => {
    const res = await app.inject({ method: 'GET', url: '/news/archive' });
    expect(res.statusCode).toBe(200);
    expect(pageMock).toHaveBeenCalledWith({ window: 'latest', cursor: null, limit: 48 });
  });

  it('passes window, cursor and limit through', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/news/archive?window=7d&cursor=1791685342000:abc&limit=20',
    });
    expect(res.statusCode).toBe(200);
    expect(pageMock).toHaveBeenCalledWith({
      window: '7d',
      cursor: '1791685342000:abc',
      limit: 20,
    });
  });

  it.each(['window=2d', 'cursor=nope', 'limit=0', 'limit=500'])('rejects %s', async (query) => {
    const res = await app.inject({ method: 'GET', url: `/news/archive?${query}` });
    expect(res.statusCode).toBe(400);
    expect(pageMock).not.toHaveBeenCalled();
  });
});
