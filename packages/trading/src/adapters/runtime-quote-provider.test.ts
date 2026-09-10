import type { ChainRuntimeRegistry, EnrichedChainResponse } from '@oggregator/core';
import { describe, expect, it, vi } from 'vitest';
import { RuntimeQuoteProvider } from './runtime-quote-provider.js';

const snapshot: EnrichedChainResponse = {
  underlying: 'BTC',
  expiry: '2026-05-29',
  expiryTs: null,
  dte: 36,
  stats: {
    forwardPriceUsd: 80_000,
    indexPriceUsd: 79_900,
    basisPct: null,
    atmStrike: 80_000,
    atmIv: 0.6,
    putCallOiRatio: null,
    totalOiUsd: null,
    skew25d: null,
    bfly25d: null,
  },
  strikes: [
    {
      strike: 80_000,
      call: {
        bestIv: 0.6,
        bestVenue: 'deribit',
        venues: {
          deribit: {
            bid: 100,
            ask: 110,
            mid: 105,
            midRaw: 0.0013125,
            bidSize: 2,
            askSize: 3,
            markIv: 0.6,
            bidIv: null,
            askIv: null,
            delta: null,
            gamma: null,
            theta: null,
            vega: null,
            spreadPct: null,
            totalCost: null,
            estimatedFees: { maker: 0, taker: 2 },
            openInterest: null,
            volume24h: null,
            openInterestUsd: null,
            volume24hUsd: null,
            asOfMs: 1_777_500_000_000,
            execution: {
              exchangeSymbol: 'BTC-29MAY26-80000-C',
              settleCurrency: 'BTC',
              inverse: true,
              quantityUnit: 'base',
              contractMultiplierBase: 0.01,
              nativeMinQuantity: 1,
              nativeQuantityStep: 1,
              nativePriceTick: 0.0001,
              minQuantity: 0.01,
              quantityStep: 0.01,
              bidSize: 0.02,
              askSize: 0.03,
              bidUsd: 10_000,
              askUsd: 11_000,
              markUsd: 10_500,
              bidMakerFeeUsd: 100,
              bidTakerFeeUsd: 200,
              askMakerFeeUsd: 110,
              askTakerFeeUsd: 220,
            },
          },
        },
      },
      put: { bestIv: null, bestVenue: null, venues: {} },
    },
  ],
  gex: [],
};

describe('RuntimeQuoteProvider', () => {
  it('retains the venue source timestamp in each quote book', async () => {
    const release = vi.fn(async () => {});
    const fetchSnapshotData = vi.fn(async () => snapshot);
    const registry = {
      acquire: vi.fn(async () => ({ runtime: { fetchSnapshotData }, release })),
    } as unknown as ChainRuntimeRegistry;
    const provider = new RuntimeQuoteProvider(registry);

    const books = await provider.getBooks(
      { underlying: 'BTC', expiry: '2026-05-29', strike: 80_000, optionRight: 'call' },
      ['deribit'],
    );

    expect(books).toHaveLength(1);
    expect(books[0]?.asOfMs).toBe(1_777_500_000_000);
    expect(books[0]).toMatchObject({
      quantityUnit: 'base',
      contractMultiplierBase: 0.01,
      bidUsd: 10_000,
      askUsd: 11_000,
      bidSize: 0.02,
      askSize: 0.03,
      minQuantity: 0.01,
      quantityStep: 0.01,
      bidTakerFeeUsd: 200,
      askTakerFeeUsd: 220,
    });
    expect(release).toHaveBeenCalledOnce();
  });

  it('excludes analytics-only venues without execution metadata', async () => {
    const release = vi.fn(async () => {});
    const withoutExecution = structuredClone(snapshot);
    const quote = withoutExecution.strikes[0]?.call.venues.deribit;
    if (quote) delete quote.execution;
    const registry = {
      acquire: vi.fn(async () => ({
        runtime: { fetchSnapshotData: vi.fn(async () => withoutExecution) },
        release,
      })),
    } as unknown as ChainRuntimeRegistry;
    const provider = new RuntimeQuoteProvider(registry);

    const books = await provider.getBooks(
      { underlying: 'BTC', expiry: '2026-05-29', strike: 80_000, optionRight: 'call' },
      ['deribit'],
    );

    expect(books).toEqual([]);
  });
});
