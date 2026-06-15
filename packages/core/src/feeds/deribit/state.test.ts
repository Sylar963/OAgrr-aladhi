import { describe, expect, it } from 'vitest';
import type { LiveQuote } from '../shared/sdk-base.js';
import {
  deribitStaleReconnectCooldownMs,
  shouldForceDeribitStaleReconnect,
  summarizeDeribitSubscribedTickerStaleness,
} from './state.js';

function createQuote(timestamp: number): LiveQuote {
  return {
    bidPrice: 1,
    askPrice: 2,
    bidSize: 1,
    askSize: 1,
    markPrice: 1.5,
    lastPrice: 1.5,
    underlyingPrice: 100_000,
    indexPrice: 100_000,
    volume24h: 1,
    openInterest: 1,
    openInterestUsd: 1,
    volume24hUsd: 1,
    greeks: {
      delta: null,
      gamma: null,
      theta: null,
      vega: null,
      rho: null,
      markIv: null,
      bidIv: null,
      askIv: null,
    },
    timestamp,
  };
}

describe('Deribit staleness summary', () => {
  it('returns null when there are no subscribed tickers', () => {
    expect(
      summarizeDeribitSubscribedTickerStaleness(new Set(), new Map(), Date.now(), 60_000, 5),
    ).toBeNull();
  });

  it('counts stale and missing subscribed quotes', () => {
    const now = 1_000_000;
    const subscribedTickers = new Set([
      'BTC-1JAN26-100-C',
      'BTC-1JAN26-100-P',
      'BTC-1JAN26-110-C',
    ]);
    const quoteStore = new Map<string, LiveQuote>([
      ['BTC-1JAN26-100-C', createQuote(now - 10_000)],
      ['BTC-1JAN26-100-P', createQuote(now - 90_000)],
    ]);

    expect(
      summarizeDeribitSubscribedTickerStaleness(subscribedTickers, quoteStore, now, 60_000, 2),
    ).toEqual({
      subscribedTickers: 3,
      staleSubscribedTickers: 2,
      missingQuotes: 1,
      oldestStaleAgeMs: 90_000,
      newestStaleAgeMs: 90_000,
      staleExamples: ['BTC-1JAN26-100-P', 'BTC-1JAN26-110-C'],
    });
  });
});

describe('Deribit forced-reconnect backoff', () => {
  it('grows the cooldown exponentially up to a ceiling', () => {
    expect(deribitStaleReconnectCooldownMs(0)).toBe(0);
    expect(deribitStaleReconnectCooldownMs(1)).toBe(60_000);
    expect(deribitStaleReconnectCooldownMs(2)).toBe(120_000);
    expect(deribitStaleReconnectCooldownMs(3)).toBe(240_000);
    expect(deribitStaleReconnectCooldownMs(10)).toBe(300_000);
  });

  it('holds until the stale window clears the grace period', () => {
    expect(
      shouldForceDeribitStaleReconnect({
        staleWindowMs: 20_000,
        graceMs: 30_000,
        msSinceLastForcedReconnect: null,
        forcedReconnectStreak: 0,
      }),
    ).toBe(false);
  });

  it('forces immediately on the first stale detection past grace', () => {
    expect(
      shouldForceDeribitStaleReconnect({
        staleWindowMs: 40_000,
        graceMs: 30_000,
        msSinceLastForcedReconnect: null,
        forcedReconnectStreak: 0,
      }),
    ).toBe(true);
  });

  it('backs off while a prior forced reconnect is still inside its cooldown', () => {
    expect(
      shouldForceDeribitStaleReconnect({
        staleWindowMs: 40_000,
        graceMs: 30_000,
        msSinceLastForcedReconnect: 45_000,
        forcedReconnectStreak: 1,
      }),
    ).toBe(false);
  });

  it('retries once the cooldown for the current streak has elapsed', () => {
    expect(
      shouldForceDeribitStaleReconnect({
        staleWindowMs: 40_000,
        graceMs: 30_000,
        msSinceLastForcedReconnect: 65_000,
        forcedReconnectStreak: 1,
      }),
    ).toBe(true);
  });
});
