import { describe, expect, it } from 'vitest';
import type { LiveQuote } from '../shared/sdk-base.js';
import {
  applyDeribitBookSummary,
  buildDeribitTickerQuote,
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

describe('applyDeribitBookSummary', () => {
  it('does not store premium-denominated volume_usd as notional volume', () => {
    // Live BTC-25DEC26-70000-P: volume_usd / volume ≈ mark premium, not spot.
    const quoteStore = new Map<string, LiveQuote>();
    applyDeribitBookSummary(
      quoteStore,
      {
        instrument_name: 'BTC-25DEC26-70000-P',
        volume: 26.1,
        volume_usd: 33185,
        open_interest: 100,
        underlying_price: 83875,
        mark_price: 0.0149,
        mark_iv: 45,
      } as Parameters<typeof applyDeribitBookSummary>[1],
      0,
      1,
      (v) => (typeof v === 'number' ? v / 100 : null),
      (v) => (typeof v === 'number' ? v : null),
    );

    const quote = quoteStore.get('BTC-25DEC26-70000-P');
    expect(quote?.volume24h).toBe(26.1);
    expect(quote?.volume24hUsd).toBeNull();
  });
});

describe('buildDeribitTickerQuote', () => {
  const num = (v: unknown) => (typeof v === 'number' ? v : null);
  const iv = (v: unknown) => (typeof v === 'number' ? v / 100 : null);

  it('counts linear alt book sizes and OI in contracts, not base coin', () => {
    // Live SOL_USDC-25DEC26-96-C: contract_size 10, best_bid_amount 10 = one contract.
    const quote = buildDeribitTickerQuote(
      {
        instrument_name: 'SOL_USDC-25DEC26-96-C',
        best_bid_price: 14.7,
        best_bid_amount: 10,
        best_ask_price: 15.4,
        best_ask_amount: 30,
        mark_price: 15.06,
        open_interest: 850,
        timestamp: 1,
      } as Parameters<typeof buildDeribitTickerQuote>[0],
      10,
      num,
      iv,
    );
    expect(quote.bidSize).toBe(1);
    expect(quote.askSize).toBe(3);
    expect(quote.openInterest).toBe(85);
  });

  it('leaves contract-size-1 instruments unchanged', () => {
    const quote = buildDeribitTickerQuote(
      {
        instrument_name: 'BTC-25DEC26-70000-P',
        best_bid_amount: 2.5,
        best_ask_amount: 0.1,
        open_interest: 100,
        timestamp: 1,
      } as Parameters<typeof buildDeribitTickerQuote>[0],
      1,
      num,
      iv,
    );
    expect(quote.bidSize).toBe(2.5);
    expect(quote.askSize).toBe(0.1);
    expect(quote.openInterest).toBe(100);
  });
});
