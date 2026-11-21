import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NewsRuntime } from './news-service.js';

function makeTweet(overrides: Record<string, unknown> = {}) {
  return {
    id: 'a1',
    text: 'BREAKING: Fed pauses rate hikes',
    url: 'https://x.com/zerohedge/status/1',
    source: 'Twitter[breaking-news] - @zerohedge',
    handle: 'zerohedge',
    ruleTag: 'breaking-news',
    timestamp: 1_700_000_000_000,
    classification: 'GOOD' as const,
    createdAt: '2024-11-14T22:13:20.000Z',
    ...overrides,
  };
}

function mockFetch(payload: unknown, status = 200): typeof fetch {
  return vi.fn(
    async () =>
      new Response(JSON.stringify(payload), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  ) as unknown as typeof fetch;
}

describe('NewsRuntime', () => {
  let runtime: NewsRuntime;

  beforeEach(() => {
    vi.useRealTimers();
  });

  it('fetches, filters to GOOD, and caches', async () => {
    const good = makeTweet({ id: 'g1' });
    const bad = makeTweet({ id: 'b1', classification: 'BAD' });
    const fetchImpl = mockFetch({ count: 2, tweets: [good, bad] });

    runtime = new NewsRuntime({
      baseUrl: 'https://news.example.com',
      secret: 'SECRET',
      fetchImpl,
      pollIntervalMs: 60_000,
    });
    await runtime.start();
    runtime.dispose();

    expect(runtime.isReady()).toBe(true);
    const items = runtime.getItems();
    expect(items.map((i) => i.id)).toEqual(['g1']);
    expect(items[0]!.classification).toBe('GOOD');
  });

  it('puts secret in URL path on first call (no since)', async () => {
    const fetchImpl = mockFetch({ count: 0, tweets: [] });
    runtime = new NewsRuntime({
      baseUrl: 'https://news.example.com',
      secret: 'SECRET',
      fetchImpl,
      pollIntervalMs: 60_000,
    });
    await runtime.start();
    runtime.dispose();

    const called = (fetchImpl as unknown as { mock: { calls: [string][] } }).mock.calls[0]![0];
    expect(called).toContain('/feed/SECRET/twitter');
    expect(called).toContain('limit=200');
    expect(called).not.toContain('since=');
  });

  it('requests the overlapping upstream window without a publication watermark', async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call++;
      if (call === 1) {
        return new Response(
          JSON.stringify({ count: 1, tweets: [makeTweet({ timestamp: 1_700_000_500_000 })] }),
          {
            status: 200,
          },
        );
      }
      return new Response(JSON.stringify({ count: 0, tweets: [] }), { status: 200 });
    }) as unknown as typeof fetch;

    runtime = new NewsRuntime({
      baseUrl: 'https://news.example.com',
      secret: 'SECRET',
      fetchImpl,
      pollIntervalMs: 60_000,
    });
    await runtime.start();
    await (runtime as unknown as { poll: () => Promise<void> }).poll();
    runtime.dispose();

    const secondCallUrl = (fetchImpl as unknown as { mock: { calls: [string][] } }).mock
      .calls[1]![0];
    expect(secondCallUrl).not.toContain('since=');
    expect(secondCallUrl).toContain('limit=200');
  });

  it('keeps cache on upstream failure and increments errors', async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call++;
      if (call === 1) {
        return new Response(JSON.stringify({ count: 1, tweets: [makeTweet({ id: 'g1' })] }), {
          status: 200,
        });
      }
      return new Response('err', { status: 500 });
    }) as unknown as typeof fetch;

    runtime = new NewsRuntime({
      baseUrl: 'https://news.example.com',
      secret: 'SECRET',
      fetchImpl,
      pollIntervalMs: 60_000,
    });
    await runtime.start();
    await (runtime as unknown as { poll: () => Promise<void> }).poll();
    runtime.dispose();

    expect(runtime.errors).toBe(1);
    expect(runtime.getItems().map((i) => i.id)).toEqual(['g1']);
  });

  it('caps cache at cacheCap', async () => {
    const tweets = Array.from({ length: 10 }, (_, i) =>
      makeTweet({ id: `g${i}`, timestamp: 1_700_000_000_000 + i }),
    );
    const fetchImpl = mockFetch({ count: tweets.length, tweets });

    runtime = new NewsRuntime({
      baseUrl: 'https://news.example.com',
      secret: 'SECRET',
      fetchImpl,
      cacheCap: 3,
      pollIntervalMs: 60_000,
    });
    await runtime.start();
    runtime.dispose();

    const items = runtime.getItems();
    expect(items).toHaveLength(3);
    expect(items.map((i) => i.id)).toEqual(['g9', 'g8', 'g7']);
  });

  it('filters items by since param', async () => {
    const tweets = [
      makeTweet({ id: 'old', timestamp: 1_700_000_000_000 }),
      makeTweet({ id: 'new', timestamp: 1_700_000_100_000 }),
    ];
    const fetchImpl = mockFetch({ count: 2, tweets });

    runtime = new NewsRuntime({
      baseUrl: 'https://news.example.com',
      secret: 'SECRET',
      fetchImpl,
      pollIntervalMs: 60_000,
    });
    await runtime.start();
    runtime.dispose();

    expect(runtime.getItems({ since: 1_700_000_050_000 }).map((i) => i.id)).toEqual(['new']);
  });

  it('flags the feed when upstream serves tweets without classification', async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call++;
      const tweets =
        call === 2
          ? [makeTweet({ id: 'g2', timestamp: 1_700_000_200_000 })]
          : [makeTweet({ id: `u${call}`, classification: undefined })];
      return new Response(JSON.stringify({ count: tweets.length, tweets }), { status: 200 });
    }) as unknown as typeof fetch;

    runtime = new NewsRuntime({
      baseUrl: 'https://news.example.com',
      secret: 'SECRET',
      fetchImpl,
      pollIntervalMs: 60_000,
    });
    await runtime.start();

    expect(runtime.isReady()).toBe(true);
    expect(runtime.isClassifying()).toBe(false);
    expect(runtime.getUnclassifiedSince()).not.toBeNull();
    expect(runtime.getItems()).toEqual([]);

    await (runtime as unknown as { poll: () => Promise<void> }).poll();
    runtime.dispose();

    expect(runtime.isClassifying()).toBe(true);
    expect(runtime.getUnclassifiedSince()).toBeNull();
    expect(runtime.getItems().map((i) => i.id)).toEqual(['g2']);
  });

  it('treats an empty poll as no signal for classification', async () => {
    const fetchImpl = mockFetch({ count: 0, tweets: [] });
    runtime = new NewsRuntime({
      baseUrl: 'https://news.example.com',
      secret: 'SECRET',
      fetchImpl,
      pollIntervalMs: 60_000,
    });
    await runtime.start();
    runtime.dispose();

    expect(runtime.isClassifying()).toBe(true);
  });
});

describe('bot news ingestion', () => {
  it('records all classifications before the dashboard GOOD filter', async () => {
    const record = vi.fn();
    const runtime = new NewsRuntime({
      baseUrl: 'https://news.example.com',
      secret: 'SECRET',
      delivery: { record },
      fetchImpl: mockFetch({
        count: 3,
        tweets: [
          makeTweet({ headlineTimestamp: '2026-11-21T03:00:00Z' }),
          makeTweet({ id: 'bad', classification: 'BAD' }),
          makeTweet({ id: 'unknown', classification: undefined }),
        ],
      }),
    });
    await runtime.start();
    runtime.dispose();
    expect(
      record.mock.calls[0]?.[0].map((item: { classification: string }) => item.classification),
    ).toEqual(['GOOD', 'BAD', 'unclassified']);
    expect(record.mock.calls[0]?.[0][0]).toMatchObject({
      upstreamHeadlineTimestamp: '2026-11-21T03:00:00Z',
    });
    expect(runtime.getItems()).toHaveLength(1);
  });

  it('reports stale polls rather than remaining ready forever', async () => {
    vi.useFakeTimers();
    const runtime = new NewsRuntime({
      baseUrl: 'https://news.example.com',
      secret: 'SECRET',
      fetchImpl: mockFetch({ count: 0, tweets: [] }),
    });
    await runtime.start();
    runtime.dispose();
    vi.setSystemTime(Date.now() + 61_000);
    expect(runtime.getHealth()).toMatchObject({ ready: false, consecutiveErrors: 0 });
    vi.useRealTimers();
  });

  it('aborts stalled upstream requests and reports failure without leaking the secret', async () => {
    vi.useFakeTimers();
    const log = { warn: vi.fn(), info: vi.fn() };
    const fetchImpl: typeof fetch = async (_input, options) =>
      new Promise((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => reject(new Error('SECRET upstream URL')));
      });
    const runtime = new NewsRuntime({
      baseUrl: 'https://news.example.com',
      secret: 'SECRET',
      fetchImpl,
      requestTimeoutMs: 100,
      log,
    });
    const start = runtime.start();
    await vi.advanceTimersByTimeAsync(100);
    await start;
    runtime.dispose();
    expect(runtime.getHealth()).toMatchObject({ ready: false, consecutiveErrors: 1 });
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain('SECRET');
    vi.useRealTimers();
  });
});
