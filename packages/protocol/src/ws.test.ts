import { describe, it, expect } from 'vitest';
import { ClientWsMessageSchema, ServerWsMessageSchema, WsSubscriptionRequestSchema } from './ws.js';

describe('WsSubscriptionRequestSchema', () => {
  it('accepts valid request', () => {
    const result = WsSubscriptionRequestSchema.safeParse({
      underlying: 'BTC',
      expiry: '2026-03-27',
      venues: ['deribit', 'okx'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty underlying', () => {
    const result = WsSubscriptionRequestSchema.safeParse({
      underlying: '',
      expiry: '2026-03-27',
      venues: ['deribit'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid expiry format', () => {
    const result = WsSubscriptionRequestSchema.safeParse({
      underlying: 'BTC',
      expiry: '27MAR26',
      venues: ['deribit'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown venue', () => {
    const result = WsSubscriptionRequestSchema.safeParse({
      underlying: 'BTC',
      expiry: '2026-03-27',
      venues: ['kraken'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty venues array', () => {
    const result = WsSubscriptionRequestSchema.safeParse({
      underlying: 'BTC',
      expiry: '2026-03-27',
      venues: [],
    });
    expect(result.success).toBe(false);
  });
});

describe('ClientWsMessageSchema', () => {
  it('accepts valid subscribe message', () => {
    const result = ClientWsMessageSchema.safeParse({
      type: 'subscribe',
      subscriptionId: 'sub-1',
      request: { underlying: 'BTC', expiry: '2026-03-27', venues: ['deribit'] },
    });
    expect(result.success).toBe(true);
  });

  it('accepts unsubscribe message', () => {
    const result = ClientWsMessageSchema.safeParse({ type: 'unsubscribe' });
    expect(result.success).toBe(true);
  });

  it('rejects subscribe without subscriptionId', () => {
    const result = ClientWsMessageSchema.safeParse({
      type: 'subscribe',
      request: { underlying: 'BTC', expiry: '2026-03-27', venues: ['deribit'] },
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown message type', () => {
    const result = ClientWsMessageSchema.safeParse({ type: 'ping' });
    expect(result.success).toBe(false);
  });

  it('rejects completely malformed input', () => {
    expect(ClientWsMessageSchema.safeParse(null).success).toBe(false);
    expect(ClientWsMessageSchema.safeParse('hello').success).toBe(false);
    expect(ClientWsMessageSchema.safeParse(42).success).toBe(false);
  });
});

describe('ServerWsMessageSchema', () => {
  const stats = {
    forwardPriceUsd: 70_000,
    indexPriceUsd: 70_000,
    basisPct: 0,
    atmStrike: 70_000,
    atmIv: 0.5,
    putCallOiRatio: 1,
    totalOiUsd: 1_000_000,
    skew25d: 0,
    bfly25d: 0,
  };

  it('accepts valid snapshot', () => {
    const result = ServerWsMessageSchema.safeParse({
      type: 'snapshot',
      subscriptionId: 'sub-1',
      seq: 5,
      request: { underlying: 'BTC', expiry: '2026-03-27', venues: ['deribit'] },
      meta: { generatedAt: 1000, maxQuoteTs: 999, staleMs: 1 },
      data: { underlying: 'BTC', expiry: '2026-03-27', expiryTs: null, dte: 7, stats, strikes: [], gex: [] },
    });
    expect(result.success).toBe(true);
  });

  it('preserves per-venue quote timestamps in snapshots', () => {
    const result = ServerWsMessageSchema.safeParse({
      type: 'snapshot',
      subscriptionId: 'sub-1',
      seq: 5,
      request: { underlying: 'BTC', expiry: '2026-03-27', venues: ['deribit'] },
      meta: { generatedAt: 1000, maxQuoteTs: 999, staleMs: 1 },
      data: {
        underlying: 'BTC',
        expiry: '2026-03-27',
        expiryTs: null,
        dte: 7,
        stats,
        strikes: [
          {
            strike: 70_000,
            call: {
              bestIv: 0.5,
              bestVenue: 'deribit',
              venues: {
                deribit: {
                  bid: 1,
                  ask: 2,
                  mid: 1.5,
                  midRaw: 1.5,
                  bidSize: 1,
                  askSize: 1,
                  markIv: 0.5,
                  bidIv: 0.49,
                  askIv: 0.51,
                  delta: 0.5,
                  gamma: 0.01,
                  theta: -0.01,
                  vega: 1,
                  spreadPct: 1,
                  totalCost: 2,
                  estimatedFees: null,
                  openInterest: 10,
                  volume24h: 1,
                  openInterestUsd: 10_000,
                  volume24hUsd: 1_000,
                  asOfMs: 999,
                },
              },
            },
            put: { bestIv: null, bestVenue: null, venues: {} },
          },
        ],
        gex: [],
      },
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.type).toBe('snapshot');
    if (result.data.type !== 'snapshot') return;
    expect(result.data.data.strikes[0]?.call.venues.deribit?.asOfMs).toBe(999);
  });

  it('accepts valid subscribed with failedVenues', () => {
    const result = ServerWsMessageSchema.safeParse({
      type: 'subscribed',
      subscriptionId: 'sub-1',
      request: { underlying: 'BTC', expiry: '2026-03-27', venues: ['deribit'] },
      serverTime: 1000,
      failedVenues: [{ venue: 'binance', reason: 'geo-blocked' }],
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid delta', () => {
    const result = ServerWsMessageSchema.safeParse({
      type: 'delta',
      subscriptionId: 'sub-1',
      seq: 6,
      request: { underlying: 'BTC', expiry: '2026-03-27', venues: ['deribit'] },
      meta: { generatedAt: 1001, maxQuoteTs: 1000, staleMs: 1 },
      patch: { stats, strikes: [], gex: [] },
    });
    expect(result.success).toBe(true);
  });

  it('accepts delta patches without gex', () => {
    const result = ServerWsMessageSchema.safeParse({
      type: 'delta',
      subscriptionId: 'sub-1',
      seq: 6,
      request: { underlying: 'BTC', expiry: '2026-03-27', venues: ['deribit'] },
      meta: { generatedAt: 1001, maxQuoteTs: 1000, staleMs: 1 },
      patch: { stats, strikes: [] },
    });
    expect(result.success).toBe(true);
  });

  it('rejects corrupt snapshot payloads', () => {
    const result = ServerWsMessageSchema.safeParse({
      type: 'snapshot',
      subscriptionId: 'sub-1',
      seq: 5,
      request: { underlying: 'BTC', expiry: '2026-03-27', venues: ['deribit'] },
      meta: { generatedAt: 1000, maxQuoteTs: 999, staleMs: 1 },
      data: { underlying: 'BTC', expiry: '2026-03-27', dte: 7, stats: {}, strikes: [], gex: [] },
    });
    expect(result.success).toBe(false);
  });

  it('accepts valid status', () => {
    const result = ServerWsMessageSchema.safeParse({
      type: 'status',
      subscriptionId: 'sub-1',
      venue: 'okx',
      state: 'reconnecting',
      ts: 1000,
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid error with null subscriptionId', () => {
    const result = ServerWsMessageSchema.safeParse({
      type: 'error',
      subscriptionId: null,
      code: 'INVALID_MESSAGE',
      message: 'bad input',
      retryable: false,
    });
    expect(result.success).toBe(true);
  });

  it('rejects snapshot with missing meta', () => {
    const result = ServerWsMessageSchema.safeParse({
      type: 'snapshot',
      subscriptionId: 'sub-1',
      seq: 1,
      request: { underlying: 'BTC', expiry: '2026-03-27', venues: ['deribit'] },
      data: {},
    });
    expect(result.success).toBe(false);
  });

  it('rejects status with invalid venue state', () => {
    const result = ServerWsMessageSchema.safeParse({
      type: 'status',
      subscriptionId: 'sub-1',
      venue: 'deribit',
      state: 'exploding',
      ts: 1000,
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown message type', () => {
    const result = ServerWsMessageSchema.safeParse({
      type: 'heartbeat',
      id: 1,
    });
    expect(result.success).toBe(false);
  });
});
