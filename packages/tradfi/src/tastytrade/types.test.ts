import { describe, expect, it } from 'vitest';
import {
  OAuthTokenResponseSchema,
  QuoteTokenResponseSchema,
  NestedChainResponseSchema,
  MarketDataResponseSchema,
} from './types.js';

describe('tastytrade REST schemas', () => {
  it('parses an oauth token response', () => {
    const r = OAuthTokenResponseSchema.safeParse({
      access_token: 'abc', token_type: 'Bearer', expires_in: 900,
    });
    expect(r.success).toBe(true);
  });

  it('parses a quote-token response', () => {
    const r = QuoteTokenResponseSchema.safeParse({
      data: { token: 't', 'dxlink-url': 'wss://x/realtime', level: 'api' },
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.data['dxlink-url']).toBe('wss://x/realtime');
  });

  it('parses a nested option chain', () => {
    const r = NestedChainResponseSchema.safeParse({
      data: { items: [{
        'underlying-symbol': 'AAPL',
        'root-symbol': 'AAPL',
        'shares-per-contract': 100,
        expirations: [{
          'expiration-date': '2026-04-17',
          'days-to-expiration': 120,
          'settlement-type': 'Physical',
          'expiration-type': 'Regular',
          strikes: [{
            'strike-price': '200.0',
            call: 'AAPL  260417C00200000',
            put: 'AAPL  260417P00200000',
            'call-streamer-symbol': '.AAPL260417C200',
            'put-streamer-symbol': '.AAPL260417P200',
          }],
        }],
      }] },
    });
    expect(r.success).toBe(true);
  });

  it('parses market-data by-type (camelCase)', () => {
    const r = MarketDataResponseSchema.safeParse({
      data: { items: [{
        symbol: 'AAPL  260417C00200000', instrumentType: 'Equity Option',
        bid: 5.1, ask: 5.3, bidSize: 10, askSize: 12, mid: 5.2, mark: 5.2,
        last: 5.2, volume: 1000, tradingHalted: false,
      }] },
    });
    expect(r.success).toBe(true);
  });
});
