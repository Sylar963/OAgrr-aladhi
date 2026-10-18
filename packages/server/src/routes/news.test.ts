import { rmSync } from 'node:fs';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';

const { getItemsMock, pageMock, findMock, verifyMock, bypass, pinsDir } = vi.hoisted(() => ({
  getItemsMock: vi.fn(),
  pageMock: vi.fn(),
  findMock: vi.fn(),
  verifyMock: vi.fn(),
  bypass: { active: false },
  pinsDir: { path: '' },
}));

vi.mock('../services.js', async () => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { NewsPinStore } = await import('../news-pins.js');
  const { NewsRelevanceEngine } = await import('../news-relevance.js');
  pinsDir.path = mkdtempSync(join(tmpdir(), 'news-pins-'));
  const newsPins = new NewsPinStore(join(pinsDir.path, 'pins.ndjson'), console);
  return {
    get newsService() {
      return { getItems: getItemsMock };
    },
    newsArchive: { page: pageMock, find: findMock },
    newsPins,
    newsRelevance: new NewsRelevanceEngine({
      history: () => [],
      pins: () => newsPins.list(),
      pinsVersion: () => newsPins.version,
    }),
  };
});

vi.mock('../clerk-verifier.js', () => ({ verifyClerkToken: verifyMock }));

vi.mock('../user-service.js', () => ({
  authDevBypassActive: () => bypass.active,
  bearerToken: (req: { headers: Record<string, unknown> }) => {
    const header = req.headers['authorization'];
    return typeof header === 'string' ? header.replace(/^Bearer\s+/i, '') : null;
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
    expect(res.json()).toMatchObject({
      count: 1,
      items: [{ id: 'a', relevance: { tier: 'normal', pinId: null } }],
    });
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

function headline(id: string, text: string, timestamp: number) {
  return {
    id,
    text,
    url: `https://x.com/a/${id}`,
    source: 'Twitter[t] - @FirstSquawk',
    handle: 'FirstSquawk',
    ruleTag: 't',
    timestamp,
    classification: 'GOOD' as const,
    createdAt: new Date(timestamp).toISOString(),
  };
}

describe('news pins', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  const CURATOR = { authorization: 'Bearer curator-jwt' };

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
    rmSync(pinsDir.path, { recursive: true, force: true });
  });

  beforeEach(async () => {
    bypass.active = false;
    process.env['NEWS_CURATOR_CLERK_IDS'] = 'user_curator, user_other';
    verifyMock.mockReset();
    verifyMock.mockImplementation(async (token: string) =>
      token === 'curator-jwt' ? { clerkUserId: 'user_curator' } : { clerkUserId: 'user_rando' },
    );
    findMock.mockReset();
    findMock.mockImplementation((id: string) => headline(id, `headline ${id}`, 1_000));
    getItemsMock.mockReset();
    getItemsMock.mockReturnValue([]);
    const listed = (await app.inject({ method: 'GET', url: '/news/pins' })).json() as {
      pins: { id: string }[];
    };
    bypass.active = true;
    for (const pin of listed.pins) {
      await app.inject({ method: 'DELETE', url: `/news/pins/${pin.id}` });
    }
    bypass.active = false;
  });

  it('lists pins publicly without edit rights', async () => {
    const res = await app.inject({ method: 'GET', url: '/news/pins' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ pins: [], max: 3, canEdit: false });
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it('reports edit rights to allow-listed curators', async () => {
    const res = await app.inject({ method: 'GET', url: '/news/pins', headers: CURATOR });
    expect(res.json()).toMatchObject({ canEdit: true });
  });

  it('rejects pin changes from anyone off the allow-list', async () => {
    const anon = await app.inject({ method: 'POST', url: '/news/pins', payload: { id: 'a' } });
    expect(anon.statusCode).toBe(403);
    const other = await app.inject({
      method: 'POST',
      url: '/news/pins',
      payload: { id: 'a' },
      headers: { authorization: 'Bearer someone-else' },
    });
    expect(other.statusCode).toBe(403);
  });

  it('closes editing when no curators are configured', async () => {
    delete process.env['NEWS_CURATOR_CLERK_IDS'];
    const res = await app.inject({
      method: 'POST',
      url: '/news/pins',
      payload: { id: 'a' },
      headers: CURATOR,
    });
    expect(res.statusCode).toBe(403);
  });

  it('pins a known headline, snapshotting it from the archive', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/news/pins',
      payload: { id: 'a' },
      headers: CURATOR,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      canEdit: true,
      pins: [{ id: 'a', text: 'headline a', handle: 'FirstSquawk', timestamp: 1_000 }],
    });
  });

  it('404s an unknown headline', async () => {
    findMock.mockReturnValue(null);
    const res = await app.inject({
      method: 'POST',
      url: '/news/pins',
      payload: { id: 'ghost' },
      headers: CURATOR,
    });
    expect(res.statusCode).toBe(404);
  });

  it('caps pins at three', async () => {
    for (const id of ['a', 'b', 'c']) {
      const ok = await app.inject({
        method: 'POST',
        url: '/news/pins',
        payload: { id },
        headers: CURATOR,
      });
      expect(ok.statusCode).toBe(200);
    }
    const res = await app.inject({
      method: 'POST',
      url: '/news/pins',
      payload: { id: 'd' },
      headers: CURATOR,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'pin_limit' });
  });

  it('unpins', async () => {
    await app.inject({ method: 'POST', url: '/news/pins', payload: { id: 'a' }, headers: CURATOR });
    const res = await app.inject({ method: 'DELETE', url: '/news/pins/a', headers: CURATOR });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ pins: [] });
    const again = await app.inject({ method: 'DELETE', url: '/news/pins/a', headers: CURATOR });
    expect(again.statusCode).toBe(404);
  });

  it('scores the feed around the pins', async () => {
    const pinned = headline('p', 'ANTHROPIC IPO DELAYED AFTER BOARD REVIEW', 1_000);
    findMock.mockReturnValue(pinned);
    await app.inject({ method: 'POST', url: '/news/pins', payload: { id: 'p' }, headers: CURATOR });
    getItemsMock.mockReturnValue([
      headline('r', 'Anthropic board review continues, people familiar say', 2_000),
      pinned,
    ]);
    const res = await app.inject({ method: 'GET', url: '/news' });
    const items = (res.json() as { items: { id: string; relevance: { pinId: string | null } }[] })
      .items;
    expect(items.map((i) => [i.id, i.relevance.pinId])).toEqual([
      ['r', 'p'],
      ['p', 'p'],
    ]);
  });
});
