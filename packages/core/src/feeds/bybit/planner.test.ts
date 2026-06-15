import { describe, expect, it } from 'vitest';
import type { CachedInstrument } from '../shared/sdk-base.js';
import {
  buildBybitExpiredTopics,
  buildBybitSubscriptionTopics,
  buildBybitTopic,
  createBybitSubscriptionState,
  markBybitSubscribedTopics,
  removeBybitSubscribedTopics,
  resetBybitSubscriptionState,
} from './planner.js';

function createInstrument(exchangeSymbol: string): CachedInstrument {
  return {
    symbol: `BTC/USDT:${exchangeSymbol}`,
    exchangeSymbol,
    base: 'BTC',
    quote: 'USDT',
    settle: 'USDT',
    expiry: '2026-03-28',
    strike: 60_000,
    right: 'call',
    inverse: false,
    contractSize: 1,
    tickSize: 0.1,
    minQty: 0.1,
    makerFee: 0.0002,
    takerFee: 0.0005,
  };
}

describe('Bybit planner', () => {
  it('builds per-instrument ticker topics', () => {
    const state = createBybitSubscriptionState();
    const plan = buildBybitSubscriptionTopics(state, [
      createInstrument('BTC-25DEC26-67000-C-USDT'),
    ]);

    expect(plan.topics).toEqual(['tickers.BTC-25DEC26-67000-C-USDT']);
    expect(state.subscribedTopics.size).toBe(0);
  });

  it('skips topics that are already subscribed', () => {
    const state = createBybitSubscriptionState();
    const instrument = createInstrument('BTC-25DEC26-67000-C-USDT');

    markBybitSubscribedTopics(state, ['tickers.BTC-25DEC26-67000-C-USDT']);
    expect(buildBybitSubscriptionTopics(state, [instrument]).topics).toEqual([]);
  });

  it('removes expired topics from tracking state', () => {
    const state = createBybitSubscriptionState();
    markBybitSubscribedTopics(state, ['tickers.BTC-25DEC26-67000-C-USDT']);

    const topics = buildBybitExpiredTopics(state, ['BTC-25DEC26-67000-C-USDT']);

    expect(topics).toEqual(['tickers.BTC-25DEC26-67000-C-USDT']);
    expect(state.subscribedTopics.size).toBe(0);
  });

  it('resets tracked topics', () => {
    const state = createBybitSubscriptionState();
    markBybitSubscribedTopics(state, ['tickers.BTC-25DEC26-67000-C-USDT']);
    resetBybitSubscriptionState(state);
    expect(state.subscribedTopics.size).toBe(0);
  });

  it('marks topics only after subscribe succeeds', () => {
    const state = createBybitSubscriptionState();
    const topic = 'tickers.BTC-25DEC26-67000-C-USDT';

    markBybitSubscribedTopics(state, [topic]);

    expect(state.subscribedTopics.has(topic)).toBe(true);
  });

  it('removes tracked topics even without a live unsubscribe', () => {
    const state = createBybitSubscriptionState();
    const topic = 'tickers.BTC-25DEC26-67000-C-USDT';
    markBybitSubscribedTopics(state, [topic]);

    removeBybitSubscribedTopics(state, [topic]);

    expect(state.subscribedTopics.has(topic)).toBe(false);
  });

  it('uses the canonical bybit topic format', () => {
    expect(buildBybitTopic('ETH-25DEC26-3000-C-USDT')).toBe('tickers.ETH-25DEC26-3000-C-USDT');
  });
});
