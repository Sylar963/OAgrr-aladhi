import type { FastifyBaseLogger } from 'fastify';
import {
  registerAdapter,
  DeribitWsAdapter,
  OkxWsAdapter,
  BinanceWsAdapter,
  BybitWsAdapter,
  DeriveWsAdapter,
  CoincallWsAdapter,
  ThalexWsAdapter,
  GateioWsAdapter,
  type MarkHistoryBuffer,
  type TradeRuntime,
} from '@oggregator/core';

const deriveAdapter = new DeriveWsAdapter();

const adapters = [
  new DeribitWsAdapter(),
  new OkxWsAdapter(),
  new BinanceWsAdapter(),
  new BybitWsAdapter(),
  deriveAdapter,
  new CoincallWsAdapter(),
  new ThalexWsAdapter(),
  new GateioWsAdapter(),
];

let tradeRuntimeRecorder: (() => void) | null = null;
let quoteRecorderUnsub: (() => void) | null = null;

export interface AdapterBootstrapDeps {
  markHistoryBuffer?: MarkHistoryBuffer;
  tradeRuntime?: TradeRuntime;
}

export async function bootstrapAdapters(
  log: FastifyBaseLogger,
  deps: AdapterBootstrapDeps = {},
) {
  log.info('loading markets for all venues');

  // Derive has no REST mark-price-history endpoint and `get_trade_history`
  // returns sparse data for low-volume contracts (HYPE options). Feed the
  // rolling buffer from both the per-tick quote stream and the live trade
  // stream so the chart panel always has something to draw.
  const buffer = deps.markHistoryBuffer;
  if (buffer && typeof deriveAdapter.addQuoteRecorder === 'function') {
    quoteRecorderUnsub = deriveAdapter.addQuoteRecorder((event) => {
      buffer.recordMark(event.venue, event.exchangeSymbol, event.ts, event.markPrice);
    });
  }
  if (buffer && deps.tradeRuntime) {
    tradeRuntimeRecorder = deps.tradeRuntime.subscribe((trade) => {
      if (trade.venue !== 'derive') return;
      buffer.recordTrade(
        trade.venue,
        trade.instrument,
        trade.timestamp,
        trade.price,
        trade.size,
      );
    });
  }

  await Promise.allSettled(
    adapters.map(async (adapter) => {
      const start = Date.now();
      try {
        await adapter.loadMarkets();
        registerAdapter(adapter);
        const underlyings = await adapter.listUnderlyings();
        log.info(
          { venue: adapter.venue, ms: Date.now() - start, underlyings: underlyings.slice(0, 5) },
          'venue loaded',
        );
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        log.warn({ venue: adapter.venue, ms: Date.now() - start, err: message }, 'venue failed');
      }
    }),
  );

  log.info('all venues bootstrapped');
}

export async function disposeAdapters(log: FastifyBaseLogger) {
  log.info('disposing venue adapters');

  if (tradeRuntimeRecorder) {
    tradeRuntimeRecorder();
    tradeRuntimeRecorder = null;
  }
  if (quoteRecorderUnsub) {
    quoteRecorderUnsub();
    quoteRecorderUnsub = null;
  }

  await Promise.allSettled(
    adapters.map(async (adapter) => {
      if (adapter.dispose == null) return;
      try {
        await adapter.dispose();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        log.warn({ venue: adapter.venue, err: message }, 'venue dispose failed');
      }
    }),
  );
}
