import { describe, expect, it } from 'vitest';
import { ACCEPT_EVENT_FIELDS, buildFeedSetup, buildSubscribe, parseFeedData } from './codec.js';

describe('dxlink codec', () => {
  it('builds a FEED_SETUP with COMPACT format', () => {
    const msg = buildFeedSetup(3);
    expect(msg.type).toBe('FEED_SETUP');
    expect(msg.acceptDataFormat).toBe('COMPACT');
    expect(msg.acceptEventFields.Quote[0]).toBe('eventType');
  });

  it('builds add/remove subscriptions', () => {
    const add = buildSubscribe(3, [{ type: 'Quote', symbol: '.AAPL200C' }], 'add');
    expect(add.add?.[0]).toEqual({ type: 'Quote', symbol: '.AAPL200C' });
    const remove = buildSubscribe(3, [{ type: 'Quote', symbol: '.AAPL200C' }], 'remove');
    expect(remove.remove?.[0]?.symbol).toBe('.AAPL200C');
  });

  it('parses a COMPACT Trade FEED_DATA frame (chunk-by-field-count, NaN->null)', () => {
    const frame = {
      type: 'FEED_DATA', channel: 3,
      data: ['Trade', ['Trade', 'SPY', 559.36, 1.3743299e7, 100.0,
                        'Trade', 'BTC/USD:CXTALP', 58356.71, 'NaN', 'NaN']],
    };
    const events = parseFeedData(frame);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ eventType: 'Trade', eventSymbol: 'SPY', price: 559.36, dayVolume: 1.3743299e7, size: 100 });
    expect(events[1]).toMatchObject({ eventType: 'Trade', eventSymbol: 'BTC/USD:CXTALP', price: 58356.71, dayVolume: null, size: null });
  });

  it('parses a Greeks frame with the documented field order', () => {
    const frame = {
      type: 'FEED_DATA', channel: 3,
      data: ['Greeks', ['Greeks', '.AAPL200C', 0.4, 0.55, 0.02, -0.03, 0.01, 0.12]],
    };
    const [g] = parseFeedData(frame);
    expect(g).toMatchObject({ eventType: 'Greeks', eventSymbol: '.AAPL200C', volatility: 0.4, delta: 0.55, gamma: 0.02, theta: -0.03, rho: 0.01, vega: 0.12 });
  });

  it('ignores non-FEED_DATA frames', () => {
    expect(parseFeedData({ type: 'FEED_CONFIG', channel: 3 })).toEqual([]);
  });
});
