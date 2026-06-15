import { describe, expect, it, vi } from 'vitest';
import { TastytradeRest } from './rest.js';

const auth = { getAccessToken: async () => 'AT' };

function jsonFetch(routes: Record<string, unknown>) {
  return vi.fn(async (url: string) => {
    const path = new URL(url).pathname;
    const body = routes[path];
    if (body == null) return { ok: false, status: 404, text: async () => 'not found', json: async () => ({}) };
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  }) as unknown as typeof fetch;
}

const cfg = { baseUrl: 'https://api.tastyworks.com', userAgent: 'ua' };

describe('TastytradeRest', () => {
  it('gets a quote token', async () => {
    const rest = new TastytradeRest(cfg, auth, jsonFetch({
      '/api-quote-tokens': { data: { token: 'QT', 'dxlink-url': 'wss://dx/realtime', level: 'api' } },
    }));
    const qt = await rest.getQuoteToken();
    expect(qt.token).toBe('QT');
    expect(qt.dxlinkUrl).toBe('wss://dx/realtime');
  });

  it('sends bearer + user-agent headers', async () => {
    const fetchImpl = jsonFetch({ '/api-quote-tokens': { data: { token: 'QT', 'dxlink-url': 'wss://x', level: 'api' } } });
    const rest = new TastytradeRest(cfg, auth, fetchImpl);
    await rest.getQuoteToken();
    const init = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]![1]!;
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer AT');
    expect(headers['User-Agent']).toBe('ua');
  });

  it('fetches a nested chain', async () => {
    const rest = new TastytradeRest(cfg, auth, jsonFetch({
      '/option-chains/AAPL/nested': { data: { items: [{ 'underlying-symbol': 'AAPL', expirations: [] }] } },
    }));
    const chain = await rest.getNestedChain('AAPL');
    expect(chain.items[0]!['underlying-symbol']).toBe('AAPL');
  });

  it('fetches market data by type with array params', async () => {
    const fetchImpl = jsonFetch({
      '/market-data/by-type': { data: { items: [{ symbol: 'AAPL', bid: 1, ask: 2 }] } },
    });
    const rest = new TastytradeRest(cfg, auth, fetchImpl);
    const data = await rest.getMarketData({ equity: ['AAPL'], equityOption: [], index: [] });
    expect(data[0]!.symbol).toBe('AAPL');
    const calledUrl = (fetchImpl as unknown as { mock: { calls: [string][] } }).mock.calls[0]![0];
    expect(calledUrl).toContain('equity=AAPL');
  });
});
