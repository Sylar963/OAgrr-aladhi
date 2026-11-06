import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import type { FlowOiRecorder, QuoteRecorderEvent } from '@oggregator/core';

const disposedVenues: string[] = [];
const quoteBatches = new Map<string, (events: readonly QuoteRecorderEvent[]) => void>();

function makeAdapterClass(venue: string) {
  return class {
    readonly venue = venue;

    async loadMarkets(): Promise<void> {}

    async listUnderlyings(): Promise<string[]> {
      return [];
    }

    addQuoteBatchRecorder(recorder: (events: readonly QuoteRecorderEvent[]) => void): () => void {
      quoteBatches.set(venue, recorder);
      return () => { quoteBatches.delete(venue); };
    }

    async dispose(): Promise<void> {
      disposedVenues.push(venue);
    }
  };
}

const registerAdapter = vi.fn();

vi.mock('@oggregator/core', () => ({
  registerAdapter,
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
    disposedVenues.length = 0;
    registerAdapter.mockClear();
    quoteBatches.clear();
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
});
