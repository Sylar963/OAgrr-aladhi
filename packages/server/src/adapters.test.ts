import type { FlowOiRecorder, QuoteRecorderEvent } from '@oggregator/core';
import type { FastifyBaseLogger } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const disposedVenues: string[] = [];
const quoteBatches = new Map<string, (events: readonly QuoteRecorderEvent[]) => void>();
const workerVenues: string[][] = [];
const workerShutdown = vi.fn();

function makeAdapterClass(venue: string) {
  return class {
    readonly venue = venue;

    async loadMarkets(): Promise<void> {}

    async listUnderlyings(): Promise<string[]> {
      return [];
    }

    addQuoteBatchRecorder(recorder: (events: readonly QuoteRecorderEvent[]) => void): () => void {
      quoteBatches.set(venue, recorder);
      return () => {
        quoteBatches.delete(venue);
      };
    }

    async dispose(): Promise<void> {
      disposedVenues.push(venue);
    }
  };
}

const registerAdapter = vi.fn();

vi.mock('@oggregator/core', () => ({
  registerAdapter,
  FeedWorkerHost: class {
    readonly venues: string[] = [];
    constructor() {
      workerVenues.push(this.venues);
    }
    adapter(venue: string) {
      this.venues.push(venue);
      return new (makeAdapterClass(venue))();
    }
    async shutdown() {
      workerShutdown();
    }
  },
  DeribitWsAdapter: makeAdapterClass('deribit'),
  OkxWsAdapter: makeAdapterClass('okx'),
  BinanceWsAdapter: makeAdapterClass('binance'),
  BybitWsAdapter: makeAdapterClass('bybit'),
  DeriveWsAdapter: makeAdapterClass('derive'),
  CoincallWsAdapter: makeAdapterClass('coincall'),
  ThalexWsAdapter: makeAdapterClass('thalex'),
  GateioWsAdapter: makeAdapterClass('gateio'),
  ParadexWsAdapter: makeAdapterClass('paradex'),
}));

describe('disposeAdapters', () => {
  beforeEach(() => {
    vi.resetModules();
    disposedVenues.length = 0;
    registerAdapter.mockClear();
    quoteBatches.clear();
    workerVenues.length = 0;
    workerShutdown.mockClear();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('isolates venue ingest in separate workers and shuts down every worker', async () => {
    vi.stubEnv('FEED_WORKER', '1');
    const { bootstrapAdapters, disposeAdapters } = await import('./adapters.js');
    const log = { info: vi.fn(), warn: vi.fn() } as unknown as FastifyBaseLogger;
    await bootstrapAdapters(log);
    expect(workerVenues).toHaveLength(9);
    expect(workerVenues.every((venues) => venues.length === 1)).toBe(true);
    expect(new Set(workerVenues.flat()).size).toBe(9);
    await disposeAdapters(log);
    expect(workerShutdown).toHaveBeenCalledTimes(9);
    expect(new Set(disposedVenues).size).toBe(9);
  });

  it('passes each quote batch to the recorder with the transactional writer', async () => {
    const { bootstrapAdapters } = await import('./adapters.js');
    const recordBatch = vi.fn();
    const writeFlowOiBatch = vi.fn();
    await bootstrapAdapters({ info: vi.fn(), warn: vi.fn() } as unknown as FastifyBaseLogger, {
      flowOiRecorder: { recordBatch } as unknown as FlowOiRecorder,
      writeFlowOiBatch,
    });
    const events: QuoteRecorderEvent[] = [
      { venue: 'deribit', exchangeSymbol: 'BTC-X', ts: 1, markPrice: 10 },
      { venue: 'deribit', exchangeSymbol: 'BTC-X', ts: 2, markPrice: 11 },
    ];
    quoteBatches.get('deribit')!(events);
    expect(recordBatch).toHaveBeenCalledExactlyOnceWith(events, writeFlowOiBatch);
  });

  it('disposes every venue adapter during shutdown', async () => {
    const { disposeAdapters } = await import('./adapters.js');

    await disposeAdapters({ info: vi.fn(), warn: vi.fn() } as unknown as FastifyBaseLogger);

    expect(new Set(disposedVenues)).toEqual(
      new Set([
        'deribit',
        'okx',
        'binance',
        'bybit',
        'derive',
        'coincall',
        'thalex',
        'gateio',
        'paradex',
      ]),
    );
  });

  it('contains persistence backpressure without crashing the feed and rate limits warnings', async () => {
    const { bootstrapAdapters } = await import('./adapters.js');
    const recordBatch = vi.fn(() => {
      throw new Error('queue is full');
    });
    const log = { info: vi.fn(), warn: vi.fn() };
    await bootstrapAdapters(log as unknown as FastifyBaseLogger, {
      flowOiRecorder: { recordBatch } as unknown as FlowOiRecorder,
    });
    expect(() => {
      quoteBatches.get('deribit')!([]);
      quoteBatches.get('deribit')!([]);
    }).not.toThrow();
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(recordBatch).toHaveBeenCalledTimes(2);
  });
});
