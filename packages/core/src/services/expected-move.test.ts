import type {
  EnrichedChainResponse,
  ExpectedStraddleQuery,
  VenueQuote,
} from '@oggregator/protocol';
import { ExpectedStraddleResponseSchema } from '@oggregator/protocol';
import { describe, expect, it } from 'vitest';
import { price76 } from '../feeds/thalex/bs-solver.js';
import {
  buildCryptoMoveSessions,
  buildExpectedMoveSession,
  evaluateExpectedStraddle,
  expectedMoveFraction,
} from './expected-move.js';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const start = Date.parse('2026-11-08T00:00:00Z');
const sessionInput = {
  startMs: start,
  endMs: start + DAY,
  open: 100_000,
  last: 101_400,
  high: 103_000,
  low: 99_000,
  openingIv: 0.5,
  ivAsOfMs: start,
  priceAsOfMs: start + DAY,
  complete: true,
  coverage: 'complete' as const,
  periodsPerYear: 365 as const,
};

describe('daily expected move', () => {
  it('uses fractions and the correct trading calendar', () => {
    expect(expectedMoveFraction(0.5, 365)).toBeCloseTo(0.0261712, 7);
    expect(expectedMoveFraction(0.2, 252)).toBeCloseTo(0.0125988, 7);
    expect(expectedMoveFraction(0.5, 365, 4)).toBeCloseTo(2 * expectedMoveFraction(0.5, 365)!);
    expect(expectedMoveFraction(0, 365)).toBeNull();
    expect(expectedMoveFraction(Number.NaN, 365)).toBeNull();
  });

  it('keeps absolute return, range and the approximate MAD premium distinct', () => {
    const result = buildExpectedMoveSession(sessionInput)!;
    expect(result.expectedUsd).toBeCloseTo(2617.1196, 3);
    expect(result.approximateStraddleUsd).toBeCloseTo(2088.16, 1);
    expect(result.absoluteReturnFraction).toBeCloseTo(0.014);
    expect(result.rangeFraction).toBeCloseTo(0.04);
    expect(result.moveRatio).toBeCloseTo(0.535);
    expect(result.classification).toBe('small');
    expect(
      buildExpectedMoveSession({ ...sessionInput, last: 97_000, low: 97_000 })?.classification,
    ).toBe('large');
  });

  it('withholds classifications for future IV, missing history and open sessions', () => {
    expect(buildExpectedMoveSession({ ...sessionInput, ivAsOfMs: start + 1 })?.classification).toBe(
      'unavailable',
    );
    expect(buildExpectedMoveSession({ ...sessionInput, coverage: 'partial' })?.classification).toBe(
      'unavailable',
    );
    expect(buildExpectedMoveSession({ ...sessionInput, complete: false })?.classification).toBe(
      'in-progress',
    );
    expect(buildExpectedMoveSession({ ...sessionInput, open: 0 })).toBeNull();
  });

  it.each([
    0, 8,
  ] as const)('anchors at %i UTC and rejects gaps without using future IV', (anchorHour) => {
    const anchor = start + anchorHour * HOUR;
    const candles = Array.from({ length: 26 }, (_, i) => ({
      timestamp: anchor + i * HOUR,
      open: 100,
      high: 101,
      low: 99,
      close: 100,
    }));
    const input = {
      candles,
      ivCandles: [
        { ...candles[0]!, timestamp: anchor - HOUR, close: 0.5 },
        { ...candles[0]!, timestamp: anchor, close: 0.9 },
      ],
      anchorHour,
      days: 1,
      nowMs: anchor + DAY + HOUR,
      latest: { price: 100.5, asOfMs: anchor + DAY + HOUR },
    };
    const sessions = buildCryptoMoveSessions(input);
    expect(sessions[0]?.startMs).toBe(anchor);
    expect(sessions[0]?.openingIv).toBe(0.5);
    expect(sessions[0]?.complete).toBe(true);
    expect(sessions[1]?.openingIv).toBeNull();
    expect(sessions[1]?.classification).toBe('unavailable');
    const gap = buildCryptoMoveSessions({ ...input, candles: candles.filter((_, i) => i !== 10) });
    expect(gap[0]?.coverage).toBe('partial');
    expect(gap[0]?.classification).toBe('unavailable');
    expect(buildCryptoMoveSessions({ ...input, ivCandles: [] })[0]?.expectedFraction).toBeNull();
  });
});

const query: ExpectedStraddleQuery = { underlying: 'BTC', venue: 'deribit', expiry: '2026-11-09' };
function quote(strike: number, right: 'call' | 'put', iv: number): VenueQuote {
  const mid = price76(100_000, strike, iv, 1 / 365, right);
  return {
    bid: mid * 0.99,
    ask: mid * 1.01,
    mid,
    midRaw: mid / 100_000,
    bidSize: 2,
    askSize: 3,
    markIv: iv,
    bidIv: null,
    askIv: null,
    delta: null,
    gamma: null,
    theta: null,
    vega: null,
    spreadPct: null,
    totalCost: null,
    estimatedFees: null,
    openInterest: null,
    volume24h: null,
    openInterestUsd: null,
    volume24hUsd: null,
    asOfMs: start,
    underlyingPriceUsd: 100_000,
  };
}
function chain(): EnrichedChainResponse {
  return {
    underlying: 'BTC',
    expiry: query.expiry,
    expiryTs: start + DAY,
    dte: 1,
    stats: {
      forwardPriceUsd: 100_000,
      indexPriceUsd: 100_000,
      basisPct: 0,
      atmStrike: 100_000,
      atmIv: 0.7,
      putCallOiRatio: null,
      totalOiUsd: null,
      skew25d: null,
      bfly25d: null,
    },
    strikes: [99_000, 100_000, 101_000].map((strike) => ({
      strike,
      call: {
        venues: { deribit: quote(strike, 'call', strike === 100_000 ? 0.7 : 0.5) },
        bestIv: null,
        bestVenue: null,
      },
      put: {
        venues: { deribit: quote(strike, 'put', strike === 100_000 ? 0.7 : 0.5) },
        bestIv: null,
        bestVenue: null,
      },
    })),
    gex: [],
  };
}

describe('same-expiry ATM straddle comparison', () => {
  it('uses actual expiry time and excludes the target strike from surface IV', () => {
    const result = evaluateExpectedStraddle(chain(), query, 0.5, start);
    expect(ExpectedStraddleResponseSchema.safeParse(result).success).toBe(true);
    expect(result.status).toBe('available');
    expect(result.surfaceIv).toBeCloseTo(0.5, 6);
    expect(result.surfaceStrikes).toEqual([99_000, 101_000]);
    expect(result.surfaceDifferenceFraction).toBeGreaterThan(0.39);
    expect(result.ask).toBeGreaterThan(result.bid!);
    expect(result.bidSize).toBe(2);
    expect(result.surfaceModel).toBeCloseTo(result.indexModel!, 4);
    const oneWeek = chain();
    oneWeek.expiryTs = start + 7 * DAY;
    expect(evaluateExpectedStraddle(oneWeek, query, 0.5, start).indexModel).toBeGreaterThan(
      result.indexModel! * 2.6,
    );
  });

  it('does not fabricate prices from marks, stale or future quotes, or mismatched assets', () => {
    const stale = chain();
    stale.strikes[1]!.call.venues.deribit!.asOfMs = start - 100_000;
    expect(evaluateExpectedStraddle(stale, query, 0.5, start).status).toBe('stale-quotes');
    stale.strikes[1]!.call.venues.deribit!.asOfMs = start + 60_000;
    expect(evaluateExpectedStraddle(stale, query, 0.5, start).status).toBe('stale-quotes');
    const missing = chain();
    missing.strikes[1]!.put.venues.deribit!.ask = null;
    expect(evaluateExpectedStraddle(missing, query, 0.5, start).ask).toBeNull();
    expect(
      evaluateExpectedStraddle(chain(), { ...query, underlying: 'ETH' }, 0.5, start).status,
    ).toBe('unavailable');
  });

  it('requires matching settlements and a bracket, never substitutes the ATM IV', () => {
    const noExpiry = chain();
    noExpiry.expiryTs = null;
    expect(evaluateExpectedStraddle(noExpiry, query, 0.5, start).status).toBe('missing-expiry');
    const unbracketed = chain();
    unbracketed.strikes = unbracketed.strikes.slice(1);
    const result = evaluateExpectedStraddle(unbracketed, query, null, start);
    expect(result.mid).not.toBeNull();
    expect(result.surfaceModel).toBeNull();
    expect(result.indexModel).toBeNull();
  });

  it('rejects mixed inverse and linear legs', () => {
    const mixed = chain();
    mixed.strikes[1]!.call.venues.deribit!.inverse = true;
    mixed.strikes[1]!.put.venues.deribit!.inverse = false;
    expect(evaluateExpectedStraddle(mixed, query, 0.5, start).status).toBe('missing-quotes');
  });
});
