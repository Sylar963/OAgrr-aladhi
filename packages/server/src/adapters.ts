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
  ParadexWsAdapter,
  FeedWorkerHost,
  type MarkHistoryBuffer,
  type OptionVenueAdapter,
  type QuoteRecorderEvent,
  type FlowOiRecorder,
  type TradeRuntime,
} from '@oggregator/core';

type ChainAdapter = OptionVenueAdapter & {
  addQuoteRecorder?: (recorder: (event: QuoteRecorderEvent) => void) => () => void;
};

// FEED_WORKER=1 moves socket handling, parsing and normalization for every chain venue onto a
// worker thread; the main thread keeps only drop-in proxies.
const feedWorker = process.env['FEED_WORKER'] === '1' ? new FeedWorkerHost() : null;

function chainAdapter(venue: OptionVenueAdapter['venue'], create: () => ChainAdapter): ChainAdapter {
  return feedWorker != null ? feedWorker.adapter(venue) : create();
}

const deribitAdapter = chainAdapter('deribit', () => new DeribitWsAdapter());
const deriveAdapter = chainAdapter('derive', () => new DeriveWsAdapter());
const coincallAdapter = chainAdapter('coincall', () => new CoincallWsAdapter());
const gateioAdapter = chainAdapter('gateio', () => new GateioWsAdapter());

const adapters: ChainAdapter[] = [
  deribitAdapter,
  chainAdapter('okx', () => new OkxWsAdapter()),
  chainAdapter('binance', () => new BinanceWsAdapter()),
  chainAdapter('bybit', () => new BybitWsAdapter()),
  deriveAdapter,
  coincallAdapter,
  chainAdapter('thalex', () => new ThalexWsAdapter()),
  gateioAdapter,
  chainAdapter('paradex', () => new ParadexWsAdapter()),
];

let tradeRuntimeRecorder: (() => void) | null = null;
const quoteRecorderUnsubs: Array<() => void> = [];

export interface AdapterBootstrapDeps {
  flowOiRecorder?: FlowOiRecorder;
  markHistoryBuffer?: MarkHistoryBuffer;
  tradeRuntime?: TradeRuntime;
}

export async function bootstrapAdapters(
  log: FastifyBaseLogger,
  deps: AdapterBootstrapDeps = {},
) {
  log.info({ feedWorker: feedWorker != null }, 'loading markets for all venues');
  if (deps.flowOiRecorder && deribitAdapter.addQuoteRecorder) {
    const recorder = deps.flowOiRecorder;
    quoteRecorderUnsubs.push(deribitAdapter.addQuoteRecorder((event) => recorder.record(event)));
  }

  // Feed the rolling mark buffer from venues whose REST chart sources are
  // either missing or trade-only:
  //   - derive: no REST mark-price-history at all
  //   - gateio: /options/candlesticks is trade-based and returns [] for the
  //     many sparse altcoin strikes that never trade
  //   - coincall: kline REST is auth-gated; the WS bsInfo `mp` is already on
  //     the chain socket so this is the cheap source
  //   - deribit: get_mark_price_history is restricted by the venue to options
  //     that participate in volatility index calculations; every other strike
  //     returns []. Recording WS marks lets the chart fall back to live data.
  // The chain adapters subscribe on demand (when a user views the chain), so
  // the buffer warms up alongside whatever the user is browsing.
  const buffer = deps.markHistoryBuffer;
  if (buffer) {
    const markRecorder = (event: QuoteRecorderEvent) => {
      buffer.recordMark(event.venue, event.exchangeSymbol, event.ts, event.markPrice);
    };
    for (const adapter of [deribitAdapter, deriveAdapter, coincallAdapter, gateioAdapter]) {
      if (typeof adapter.addQuoteRecorder === 'function') {
        quoteRecorderUnsubs.push(adapter.addQuoteRecorder(markRecorder));
      }
    }
  }
  if (buffer && deps.tradeRuntime) {
    // Derive: no REST trade history at all.
    // Coincall: kline REST is auth-gated; live prints become the only trade
    // source for the chart panel.
    // Gate.io: /options/candlesticks covers traded strikes; recording WS
    // prints here is harmless and gives sub-second freshness for any strike
    // the user is actively watching.
    const TRADE_BUFFER_VENUES = new Set(['derive', 'coincall', 'gateio']);
    tradeRuntimeRecorder = deps.tradeRuntime.subscribe((trade) => {
      if (!TRADE_BUFFER_VENUES.has(trade.venue)) return;
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
  while (quoteRecorderUnsubs.length > 0) {
    const unsub = quoteRecorderUnsubs.pop();
    unsub?.();
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
  await feedWorker?.shutdown();
}
