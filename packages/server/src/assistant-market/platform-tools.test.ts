import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { AssistantMcpHandler, buildAssistantMcpTools } from './assistant-mcp-server.js';
import { AssistantMarketDataReader } from './market-data-reader.js';
import { PortfolioRefStore } from './portfolio-ref.js';
import { OptionsLibrary } from './options-library.js';
import { ToolErrorPayloadSchema } from './tool-errors.js';

function harness(body: unknown, statusCode = 200) {
  const reader = new AssistantMarketDataReader(() => Date.UTC(2026, 8, 28));
  const inject = vi.fn(async (_path: string) => ({ statusCode, body }));
  reader.bind(inject);
  const library = new OptionsLibrary('/tmp/oggregator-nonexistent-test-library.sqlite');
  const handler = new AssistantMcpHandler(buildAssistantMcpTools(reader, library, {
    refs: new PortfolioRefStore(),
    resolveHeldLegs: async () => [],
  }), Fastify().log);
  return {
    inject,
    call: (name: string, args: Record<string, unknown> = {}) =>
      handler.handle({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name, arguments: args },
      }),
  };
}

function resultData(reply: unknown) {
  const parsed = reply as { result: { content: Array<{ text: string }>; isError?: boolean } };
  const body: unknown = JSON.parse(parsed.result.content[0]!.text);
  const error = ToolErrorPayloadSchema.safeParse(body);
  return {
    ...parsed.result,
    error: error.success ? error.data : null,
    data: error.success ? null : body,
  };
}

describe('assistant platform tools', () => {
  it('returns bounded news with provenance and strips unrelated fields', async () => {
    const { call, inject } = harness({
      count: 1,
      items: [
        {
          text: 'Market update',
          url: 'https://example.com/item',
          source: 'feed',
          timestamp: 123,
          internal: 'omit',
        },
      ],
    });
    const result = resultData(await call('oggregator_news', { limit: 1 }));
    expect(inject).toHaveBeenCalledWith('/api/news?limit=1');
    expect(result.data).toMatchObject({
      source: '/api/news',
      retrievedAt: '2026-09-28T00:00:00.000Z',
    });
    expect(result.data.data.items[0]).not.toHaveProperty('internal');
    expect(result.data.notes.join(' ')).toContain('untrusted');
  });

  it('does not expose operational internals from health', async () => {
    const { call } = harness({
      status: 'ready',
      ts: 123,
      venues: ['deribit'],
      services: {
        flow: true,
        dvol: true,
        spot: true,
        blockFlow: true,
        ivHistory: false,
        news: false,
        ivHistoryStorage: { connection: 'private' },
      },
      feeds: {
        summary: { totalVenues: 1, connectedVenues: 1, lastAnyMessageAgeMs: 3 },
        venues: [],
      },
      runtime: { private: 'omit' },
    });
    const result = resultData(await call('oggregator_feed_health'));
    expect(result.data.data).not.toHaveProperty('runtime');
    expect(result.data.data.services).not.toHaveProperty('ivHistoryStorage');
  });

  it.each([
    ['oggregator_news', { limit: 31 }],
    ['oggregator_trade_flow', { underlying: 'BTC', limit: 51 }],
    ['oggregator_spot_candles', { currency: 'BTC', buckets: 201 }],
    ['oggregator_spot_candles', { currency: 'BTC', resolution: 42 }],
    ['oggregator_straddle_scanner', { underlying: 'BTC', venues: ['deribit'] }],
    [
      'oggregator_straddle_scanner',
      { underlying: 'BTC', venues: ['deribit'], equity: 1000, riskPct: 1, minDte: 10, maxDte: 2 },
    ],
    [
      'oggregator_lotto_scanner',
      {
        underlying: 'BTC',
        venues: ['deribit'],
        premiumCap: 100,
        buyingPower: 1000,
        minOtmPct: 20,
        maxOtmPct: 10,
      },
    ],
    ['oggregator_put_scanner', { underlying: 'BTC', venues: ['deribit'], rankBy: 'yolo' }],
    ['oggregator_put_scanner', { underlying: 'BTC', venues: ['deribit'], minDte: 30, maxDte: 7 }],
  ])('rejects invalid or unbounded inputs for %s', async (name, args) => {
    const { call, inject } = harness({});
    const result = resultData(await call(name, args));
    expect(result.error?.code).toBe('invalid_arguments');
    expect(result.isError).toBeUndefined();
    expect(inject).not.toHaveBeenCalled();
  });

  it('encodes scanner arguments and accepts platform venue IDs', async () => {
    const { call, inject } = harness({}, 503);
    const result = resultData(
      await call('oggregator_lotto_scanner', {
        underlying: 'BTC',
        venues: ['gateio', 'derive'],
        premiumCap: 200,
        buyingPower: 1000,
      }),
    );
    expect(inject).toHaveBeenCalledOnce();
    const url = new URL(inject.mock.calls[0]![0] as string, 'http://localhost');
    expect(url.pathname).toBe('/api/alpha/lotto-scanner');
    expect(url.searchParams.get('venues')).toBe('gateio,derive');
    expect(result.error).toMatchObject({ ok: false, code: 'upstream_unavailable', retryable: true });
    expect(result.isError).toBeUndefined();
  });

  it('routes put scans with hedge sizing to the put scanner', async () => {
    const { call, inject } = harness({}, 503);
    await call('oggregator_put_scanner', {
      underlying: 'BTC',
      venues: ['deribit'],
      hedgeQty: 2,
    });
    expect(inject).toHaveBeenCalledOnce();
    const url = new URL(inject.mock.calls[0]![0] as string, 'http://localhost');
    expect(url.pathname).toBe('/api/alpha/put-scanner');
    expect(url.searchParams.get('hedgeQty')).toBe('2');
    expect(url.searchParams.get('rankBy')).toBe('protection');
  });

  it('rejects malformed data instead of passing it to the model', async () => {
    const { call } = harness({ currency: 'BTC', candles: 'invalid' });
    const result = resultData(await call('oggregator_spot_candles', { currency: 'BTC' }));
    expect(result.error?.code).toBe('upstream_error');
    expect(result.error?.error).toContain('Unexpected payload');
  });

  it('cannot use a tool name to access private routes', async () => {
    const { call, inject } = harness({});
    expect(resultData(await call('/api/portfolio/venue-credentials')).error?.code).toBe('unknown_tool');
    expect(inject).not.toHaveBeenCalled();
  });
});
