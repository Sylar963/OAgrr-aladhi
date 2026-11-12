import type { ExpectedMoveResponse, ExpectedStraddleResponse } from '@oggregator/protocol';

export const TEST_START = Date.parse('2026-11-11T00:00:00Z');
export const TEST_NOW = TEST_START + 12 * 3_600_000;

export function radarReport(): ExpectedMoveResponse {
  return {
    underlying: 'BTC',
    anchor: 'utc0',
    generatedAt: TEST_NOW,
    periodsPerYear: 365,
    index: 'DVOL',
    priceSource: 'aggregated-spot',
    liveIv: 0.7,
    liveIvAsOfMs: TEST_NOW,
    current: {
      startMs: TEST_START,
      endMs: TEST_START + 86_400_000,
      open: 100_000,
      last: 103_000,
      high: 104_000,
      low: 99_000,
      priceAsOfMs: TEST_NOW,
      openingIv: 0.5,
      ivAsOfMs: TEST_START,
      expectedFraction: 0.02617,
      expectedUsd: 2617,
      approximateStraddleUsd: 2088,
      lower: 97383,
      upper: 102617,
      returnFraction: 0.03,
      absoluteReturnFraction: 0.03,
      rangeFraction: 0.05,
      moveRatio: 1.146,
      complete: false,
      coverage: 'complete',
      classification: 'in-progress',
    },
    history: [],
  };
}

export function radarQuote(): ExpectedStraddleResponse {
  return {
    underlying: 'BTC',
    expiry: '2026-11-12',
    venue: 'deribit',
    generatedAt: TEST_NOW,
    status: 'available',
    strike: 100_000,
    forward: 103_100,
    expiryTs: TEST_START + 86_400_000 + 8 * 3_600_000,
    quoteAsOfMs: TEST_NOW,
    bid: 2300,
    ask: 2400,
    mid: 2350,
    bidSize: 2,
    askSize: 3,
    indexIv: 0.5,
    indexModel: 2088,
    surfaceIv: 0.52,
    surfaceModel: 2170,
    surfaceStrikes: [99000, 101000],
    indexDifferenceFraction: 0.125,
    surfaceDifferenceFraction: 0.083,
  };
}

export function radarCandles() {
  return Array.from({ length: 144 }, (_, i) => ({
    timestamp: TEST_START + i * 300_000,
    open: 100_000 + i * 15,
    close: 100_000 + (i + 1) * 15,
  }));
}
