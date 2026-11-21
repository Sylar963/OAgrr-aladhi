import { describe, expect, it } from 'vitest';
import { BotMarketQuerySchema, EnrichedChainResponseSchema } from '@oggregator/protocol';
import { assessBotMarket } from './bot-market.js';

const now = Date.UTC(2026, 10, 21);
function chain() {
  const venue = {
    bid: 100,
    ask: 110,
    mid: 105,
    midRaw: 105,
    bidSize: 100,
    askSize: 100,
    markIv: 0.5,
    bidIv: 0.49,
    askIv: 0.51,
    delta: 0.5,
    gamma: 0.001,
    theta: -3,
    vega: 4,
    spreadPct: 10,
    totalCost: 110,
    estimatedFees: null,
    openInterest: 10,
    volume24h: 2,
    openInterestUsd: 1000,
    volume24hUsd: 200,
    asOfMs: now - 100,
    execution: {
      exchangeSymbol: 'BTC-USD-261127-60000-C',
      settleCurrency: 'BTC',
      inverse: true,
      quantityUnit: 'base',
      contractMultiplierBase: 0.01,
      nativeMinQuantity: 1,
      nativeQuantityStep: 1,
      nativePriceTick: 0.0001,
      minQuantity: 0.01,
      quantityStep: 0.01,
      bidSize: 1,
      askSize: 1,
      bidUsd: 100,
      askUsd: 110,
      markUsd: 105,
      bidMakerFeeUsd: 1,
      bidTakerFeeUsd: 1,
      askMakerFeeUsd: 1,
      askTakerFeeUsd: 1,
    },
  };
  return EnrichedChainResponseSchema.parse({
    underlying: 'BTC',
    expiry: '2026-11-27',
    expiryTs: now + 86400000,
    dte: 1,
    stats: {
      forwardPriceUsd: 60000,
      indexPriceUsd: 60000,
      basisPct: 0,
      atmStrike: 60000,
      atmIv: 0.5,
      putCallOiRatio: null,
      totalOiUsd: null,
      skew25d: null,
      bfly25d: null,
    },
    gex: [],
    strikes: [
      {
        strike: 60000,
        call: { venues: { okx: venue }, bestIv: 0.5, bestVenue: 'okx' },
        put: { venues: {}, bestIv: null, bestVenue: null },
      },
    ],
  });
}
const query = BotMarketQuerySchema.parse({
  underlying: 'BTC',
  expiry: '2026-11-27',
  venues: 'okx',
});

describe('bot market quality', () => {
  it('accepts fresh sized quotes using canonical execution fields', () => {
    const result = assessBotMarket(chain(), query, { okx: 'connected' }, now);
    expect(result.dataReady).toBe(true);
    expect(result.quality[0]?.eligible).toBe(true);
  });

  it('rejects stale, crossed, unsized, missing-Greek and offline quotes', () => {
    const data = chain();
    const quote = data.strikes[0]!.call.venues['okx']!;
    quote.asOfMs = now - 6000;
    quote.gamma = null;
    quote.execution!.bidUsd = 120;
    quote.execution!.askSize = 0;
    const result = assessBotMarket(data, query, { okx: 'reconnecting' }, now);
    expect(result.dataReady).toBe(false);
    expect(result.quality[0]?.reasons).toEqual(
      expect.arrayContaining([
        'stale-quote',
        'crossed-quote',
        'missing-sized-quote',
        'missing-greeks',
        'venue-not-live',
      ]),
    );
  });

  it('does not use raw contract sizes or mark prices as executable liquidity', () => {
    const data = chain();
    data.strikes[0]!.call.venues['okx']!.execution!.askSize = null;
    expect(assessBotMarket(data, query, { okx: 'connected' }, now).dataReady).toBe(false);
  });

  it('includes requested venues with no quotes and rejects expired and future-dated observations', () => {
    const data = chain();
    data.expiryTs = now - 1;
    data.strikes[0]!.call.venues['okx']!.asOfMs = now + 5000;
    const result = assessBotMarket(
      data,
      { ...query, venues: ['okx', 'deribit'] },
      { okx: 'connected' },
      now,
    );
    expect(result.venues[1]).toMatchObject({ venue: 'deribit', quotes: 0, eligibleQuotes: 0 });
    expect(result.quality[0]?.reasons).toEqual(
      expect.arrayContaining(['future-timestamp', 'missing-or-expired-expiry']),
    );
    expect(result.dataReady).toBe(false);
  });

  it.each(['unknown', 'okx,unknown', ''])('rejects unsupported venue input %s', (venues) => {
    expect(
      BotMarketQuerySchema.safeParse({ underlying: 'BTC', expiry: '2026-11-27', venues }).success,
    ).toBe(false);
  });
});
