import type { EnrichedStrike, SpotCandle, VenueQuote } from '@oggregator/core';
import {
  AlphaLongStraddleScannerResponseSchema,
  AlphaStraddleScannerResponseSchema,
} from '@oggregator/protocol';
import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

const DAY_MS = 86_400_000;
const FORWARD = 60_000;
const STRIKE = 60_000;

const mocks = vi.hoisted(() => ({
  createExpiryChainSource: vi.fn(),
  syncSubscriptions: vi.fn(async () => 0),
  fetchChains: vi.fn(),
}));

function candles(): SpotCandle[] {
  let close = FORWARD;
  const now = Date.now();
  return Array.from({ length: 200 }, (_, index) => {
    if (index > 0) close *= Math.exp(index % 2 === 0 ? 0.02 : -0.02);
    return { timestamp: now - (200 - index) * DAY_MS, open: close, high: close, low: close, close };
  });
}

function leg(price: number, delta: number): VenueQuote {
  return {
    bid: price,
    ask: price * 1.02,
    mid: price * 1.01,
    midRaw: null,
    bidSize: 2,
    askSize: 2,
    markIv: 0.38,
    bidIv: null,
    askIv: null,
    delta,
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
    asOfMs: Date.now() - 1_000,
    underlyingPriceUsd: FORWARD,
    inverse: false,
    execution: {
      exchangeSymbol: delta > 0 ? 'TEST-C' : 'TEST-P',
      settleCurrency: 'USDC',
      inverse: false,
      quantityUnit: 'base',
      contractMultiplierBase: 1,
      nativeMinQuantity: 0.01,
      nativeQuantityStep: 0.01,
      nativePriceTick: 1,
      minQuantity: 0.01,
      quantityStep: 0.01,
      bidSize: 2,
      askSize: 2,
      bidUsd: price,
      askUsd: price * 1.02,
      markUsd: price * 1.01,
      bidMakerFeeUsd: 1,
      bidTakerFeeUsd: 3,
      askMakerFeeUsd: 1,
      askTakerFeeUsd: 3,
    },
  };
}

function atmStrike(): EnrichedStrike {
  return {
    strike: STRIKE,
    call: { venues: { deribit: leg(1_800, 0.5) }, bestIv: null, bestVenue: null },
    put: { venues: { deribit: leg(1_780, -0.5) }, bestIv: null, bestVenue: null },
  };
}

vi.mock('../services.js', () => ({
  DAILY_SPOT_HISTORY_DAYS: 730,
  isIvHistoryReady: () => false,
  isSpotCandlesReady: () => true,
  ivHistoryService: { query: () => null },
  ivBaselineHistory: { get: async () => ({ '7d': [], '30d': [] }) },
  venueIvBaselineHistory: { get: async () => new Map() },
  spotCandleService: { getCandles: async () => candles() },
  spotService: { getSnapshot: () => null },
}));

vi.mock('../alpha-expiry-chains.js', () => ({
  buildVenuePlan: async (venue: string) => ({ venue, expiries: ['2099-01-01'], error: null }),
  createExpiryChainSource: mocks.createExpiryChainSource,
}));

vi.mock('@oggregator/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@oggregator/core')>()),
  buildComparisonChain: () => ({ rows: [] }),
  buildEnrichedChain: () => ({ strikes: [atmStrike()] }),
}));

mocks.createExpiryChainSource.mockImplementation(() => ({
  syncSubscriptions: mocks.syncSubscriptions,
  fetchChains: mocks.fetchChains,
}));
mocks.fetchChains.mockImplementation(async () => [
  {
    venue: 'deribit',
    expiry: '2099-01-01',
    chain: { contracts: { c: { expiryTs: Date.now() + 7 * DAY_MS } } },
  },
]);

const { alphaStraddleScannerRoute } = await import('./alpha-straddle-scanner.js');

async function app() {
  const server = Fastify();
  await server.register(alphaStraddleScannerRoute);
  return server;
}

afterEach(() => {
  mocks.syncSubscriptions.mockClear();
});

describe('alphaStraddleScannerRoute', () => {
  it('shares one chain source between the sell and buy scanners', async () => {
    mocks.createExpiryChainSource.mockClear();
    const server = await app();
    expect(mocks.createExpiryChainSource).toHaveBeenCalledOnce();
    await server.close();
  });

  it('scans short straddles at the bids', async () => {
    const server = await app();
    const response = await server.inject({
      method: 'GET',
      url: '/alpha/straddle-scanner?underlying=BTC&venues=deribit&minDte=1&maxDte=30',
    });
    expect(response.statusCode).toBe(200);
    const body = AlphaStraddleScannerResponseSchema.parse(response.json());
    expect(body.candidates).toHaveLength(1);
    expect(body.candidates[0]).toMatchObject({ venue: 'deribit', strike: STRIKE, netCredit: 1_800 + 1_780 - 6 });
    expect(body.forecast.rv7d).not.toBeNull();
    expect(mocks.syncSubscriptions).toHaveBeenCalledOnce();
    await server.close();
  });

  it('scans long straddles at the asks with the weekend-adjusted forecast', async () => {
    const server = await app();
    const response = await server.inject({
      method: 'GET',
      url: '/alpha/long-straddle-scanner?underlying=BTC&venues=deribit&minDte=1&maxDte=30',
    });
    expect(response.statusCode).toBe(200);
    const body = AlphaLongStraddleScannerResponseSchema.parse(response.json());
    expect(body.candidates).toHaveLength(1);
    const [candidate] = body.candidates;
    expect(candidate!.netDebit).toBeCloseTo((1_800 + 1_780) * 1.02 + 6, 8);
    expect(candidate!.weekendShare).toBeGreaterThan(0.25);
    expect(candidate!.calendarForecastVol).not.toBeNull();
    await server.close();
  });

  it('rejects invalid queries at the boundary', async () => {
    const server = await app();
    for (const url of [
      '/alpha/straddle-scanner?minDte=30&maxDte=1',
      '/alpha/long-straddle-scanner?minDte=30&maxDte=1',
    ]) {
      const response = await server.inject({ method: 'GET', url });
      expect(response.statusCode).toBe(400);
    }
    expect(mocks.syncSubscriptions).not.toHaveBeenCalled();
    await server.close();
  });
});
