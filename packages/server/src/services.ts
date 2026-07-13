import {
  BlockTradeRuntime,
  buildIvSurfaceGrid,
  DvolService,
  getAdapter,
  getAllAdapters,
  IndexPriceRuntime,
  InstrumentCandleService,
  IvHistoryService,
  interpBasisToTenor,
  MarkHistoryBuffer,
  type RegimeInputs,
  type RegimePersistence,
  RegimeService,
  SpotCandleService,
  SpotRuntime,
  TradeRuntime,
  type VenueId,
} from '@oggregator/core';
import {
  DEFAULT_IV_HISTORY_SIZE_WARN_BYTES,
  type DealerBookStore,
  type IvHistoryStorageStats,
  type IvHistoryStore,
  type LeadsStore,
  NoopDealerBookStore,
  NoopIvHistoryStore,
  NoopLeadsStore,
  NoopOiSnapshotStore,
  NoopRegimeStore,
  NoopTradeStore,
  type OiSnapshotStore,
  PostgresDealerBookStore,
  PostgresIvHistoryStore,
  PostgresLeadsStore,
  PostgresOiSnapshotStore,
  PostgresRegimeStore,
  PostgresShortStraddleSnapshotStore,
  PostgresTradeStore,
  type RegimeStore,
  type ShortStraddleSnapshotStore,
  type TradeStore,
} from '@oggregator/db';
import type { FastifyBaseLogger } from 'fastify';
import { registerBookLookup } from './dealer-book-lookup.js';
import { DealerBookService, type IntervalFlow } from './dealer-book-service.js';
import {
  DeferredDealerBookStore,
  DeferredIvHistoryStore,
  DeferredOiSnapshotStore,
  DeferredRegimeStore,
  DeferredShortStraddleSnapshotStore,
} from './deferred-persistence.js';
import { createNewsRuntimeFromEnv, type NewsRuntime } from './news-service.js';
import { disposeSettlementJob, startSettlementJob } from './settlement-service.js';
import { ShortStraddleSnapshotService } from './short-straddle-snapshot-service.js';

export const dvolService = new DvolService();
export const spotService = new SpotRuntime();
export const spotCandleService = new SpotCandleService();
// Rolling mark + trade buffer for venues with no REST mark-history endpoint
// (Derive). Fed by every adapter's quote recorder and by TradeRuntime, queried
// by the instrument-candles service when the chart panel asks for history.
export const markHistoryBuffer = new MarkHistoryBuffer();
export const instrumentCandleService = new InstrumentCandleService({ markHistoryBuffer });
export const flowService = new TradeRuntime();
export const blockFlowService = new BlockTradeRuntime();
// Third-tier fallback for `referencePriceUsd` lookups (after trade.indexPrice
// and Binance USDT SpotRuntime). Sourced from Gate.io's `/options/underlyings`
// REST poll (covers XTI/CL crude) and Coincall's bsInfo WS channel (covers
// MNT/LIT/KAS — Coincall-listed altcoins with no Binance USDT spot pair).
export const indexPriceService = new IndexPriceRuntime();
export let newsService: NewsRuntime | null = null;
const FLOW_ALWAYS_ON_UNDERLYINGS = ['BTC', 'ETH', 'SOL'] as const;
const databaseUrl = process.env['DATABASE_URL'];
const DAY_MS = 24 * 60 * 60 * 1000;
const marketDataDbFlushIntervalMs = parseNonNegativeMs(
  process.env['MARKET_DATA_DB_FLUSH_INTERVAL_MS'],
  DAY_MS,
  'MARKET_DATA_DB_FLUSH_INTERVAL_MS',
);
const dealerBookDbFlushIntervalMs = parseNonNegativeMs(
  process.env['DEALER_BOOK_DB_FLUSH_INTERVAL_MS'],
  marketDataDbFlushIntervalMs,
  'DEALER_BOOK_DB_FLUSH_INTERVAL_MS',
);
const ivHistoryDbFlushIntervalMs = parseNonNegativeMs(
  process.env['IV_HISTORY_DB_FLUSH_INTERVAL_MS'],
  marketDataDbFlushIntervalMs,
  'IV_HISTORY_DB_FLUSH_INTERVAL_MS',
);
const regimeDbFlushIntervalMs = parseNonNegativeMs(
  process.env['REGIME_DB_FLUSH_INTERVAL_MS'],
  marketDataDbFlushIntervalMs,
  'REGIME_DB_FLUSH_INTERVAL_MS',
);
const dealerBookOiCacheMaxRows = parsePositiveInteger(
  process.env['DEALER_BOOK_OI_CACHE_MAX_ROWS'],
  5_000_000,
  'DEALER_BOOK_OI_CACHE_MAX_ROWS',
);
const dealerBookCacheMaxRows = parsePositiveInteger(
  process.env['DEALER_BOOK_CACHE_MAX_ROWS'],
  100_000,
  'DEALER_BOOK_CACHE_MAX_ROWS',
);
const ivHistoryCacheMaxRows = parsePositiveInteger(
  process.env['IV_HISTORY_CACHE_MAX_ROWS'],
  200_000,
  'IV_HISTORY_CACHE_MAX_ROWS',
);
const regimeObservationsCacheMaxRows = parsePositiveInteger(
  process.env['REGIME_OBSERVATIONS_CACHE_MAX_ROWS'],
  200_000,
  'REGIME_OBSERVATIONS_CACHE_MAX_ROWS',
);
const ivHistorySizeWarnBytes = parseIvHistoryWarnBytes(process.env['IV_HISTORY_SIZE_WARN_BYTES']);
const shortStraddleSnapshotsEnabled = parseBoolean(process.env['SHORT_STRADDLE_SNAPSHOTS_ENABLED']);
const shortStraddleQuoteMaxAgeMs = parseNonNegativeMs(
  process.env['SHORT_STRADDLE_QUOTE_MAX_AGE_MS'],
  60_000,
  'SHORT_STRADDLE_QUOTE_MAX_AGE_MS',
);
export const shortStraddleSnapshotStore: ShortStraddleSnapshotStore | null =
  shortStraddleSnapshotsEnabled && databaseUrl
    ? createShortStraddleSnapshotStore(databaseUrl)
    : null;
export const shortStraddleSnapshotService = shortStraddleSnapshotStore
  ? new ShortStraddleSnapshotService(shortStraddleSnapshotStore, {
      quoteMaxAgeMs: shortStraddleQuoteMaxAgeMs,
    })
  : null;
let shortStraddleLog: { warn: (obj: object, msg: string) => void } = console;
export const ivHistoryStore: IvHistoryStore = databaseUrl
  ? createIvHistoryStore(databaseUrl)
  : new NoopIvHistoryStore(ivHistorySizeWarnBytes);
export const ivHistoryService = new IvHistoryService({
  dvol: dvolService,
  store: ivHistoryStore,
  getSurfaceGrid: async (underlying: string) => {
    const entries = await buildIvSurfaceGrid({ underlying });
    if (underlying.toUpperCase() === 'BTC' && shortStraddleSnapshotService != null) {
      try {
        const spotPriceUsd = spotService.getSnapshot('BTC')?.lastPrice ?? Number.NaN;
        await shortStraddleSnapshotService.collect(entries, spotPriceUsd);
      } catch (err: unknown) {
        shortStraddleLog.warn(
          { err: String(err) },
          'short-straddle snapshot collector failed during IV history',
        );
      }
    }
    return entries.map((e) => e.surfaceRow);
  },
});
export const tradeStore: TradeStore = databaseUrl
  ? PostgresTradeStore.fromConnectionString(databaseUrl)
  : new NoopTradeStore();

export const leadsStore: LeadsStore = databaseUrl
  ? PostgresLeadsStore.fromConnectionString(databaseUrl)
  : new NoopLeadsStore();

export const oiSnapshotStore: OiSnapshotStore = databaseUrl
  ? createOiSnapshotStore(databaseUrl)
  : new NoopOiSnapshotStore();

export const dealerBookStore: DealerBookStore = databaseUrl
  ? createDealerBookStore(databaseUrl)
  : new NoopDealerBookStore();

export const dealerBookService = new DealerBookService({
  underlyings: [...FLOW_ALWAYS_ON_UNDERLYINGS],
  oiSnapshotStore,
  dealerBookStore,
  listExpiries: async (underlying) => {
    const lists = await Promise.all(getAllAdapters().map((a) => a.listExpiries(underlying)));
    const all = new Set<string>();
    for (const list of lists) for (const e of list) all.add(e);
    return [...all].sort();
  },
  listVenues: () => getAllAdapters().map((a) => a.venue),
  fetchChain: async (venue: VenueId, underlying, expiry) => {
    try {
      return await getAdapter(venue).fetchOptionChain({ underlying, expiry });
    } catch {
      return null;
    }
  },
  fetchIntervalFlow: async (venue, symbol, underlying, fromTs, toTs): Promise<IntervalFlow> => {
    // Attribute ΔOI from the lit/live tape only. Block ('institutional') flow is
    // deliberately excluded — block-trade aggressor sign is ambiguous — so
    // block-driven OI changes fall through to the naive-prior sign in the book.
    const tape = flowService
      .getTrades(underlying)
      .filter((trade) => !trade.isBlock && trade.venue === venue && trade.instrument === symbol);
    if (tape.length === 0 || tape[0]!.timestamp > fromTs) {
      return { netFlow: 0, hasFlow: false };
    }
    const buffered = tape.filter((trade) => trade.timestamp > fromTs && trade.timestamp <= toTs);
    if (buffered.length === 0) return { netFlow: 0, hasFlow: false };
    const net = buffered.reduce((acc, t) => acc + (t.side === 'buy' ? t.size : -t.size), 0);
    return { netFlow: net, hasFlow: true };
  },
});

registerBookLookup(dealerBookService.lookup);

export const regimeStore: RegimeStore = databaseUrl
  ? createRegimeStore(databaseUrl)
  : new NoopRegimeStore();

const regimePersistence: RegimePersistence = {
  enabled: regimeStore.enabled,
  loadModel: async (underlying) => {
    const persisted = await regimeStore.loadModel(underlying);
    if (!persisted) return null;
    const hmm = persisted.hmm as RegimePersistedHmm;
    const standardization = persisted.standardization as RegimePersistedStandardization;
    return {
      underlying: persisted.underlying,
      fittedAt: persisted.fittedAt.getTime(),
      observationCount: persisted.observationCount,
      hmm,
      standardization,
      stateLabels: persisted.stateLabels,
    };
  },
  saveModel: async (model) => {
    await regimeStore.saveModel({
      underlying: model.underlying,
      fittedAt: new Date(model.fittedAt),
      observationCount: model.observationCount,
      nStates: model.hmm.nStates,
      hmm: model.hmm,
      standardization: model.standardization,
      stateLabels: model.stateLabels,
    });
  },
  loadObservationsSince: async ({ underlyings, since }) => {
    const rows = await regimeStore.loadObservationsSince({
      underlyings,
      since: new Date(since),
    });
    return rows.map((r) => ({
      underlying: r.underlying,
      ts: r.ts.getTime(),
      features: r.features,
      posterior: r.posterior,
      dominant: r.dominant,
    }));
  },
  saveObservation: async (row) => {
    await regimeStore.saveObservation({
      underlying: row.underlying,
      ts: new Date(row.ts),
      features: row.features,
      posterior: row.posterior,
      dominant: row.dominant,
    });
  },
};

// RegimeService is BTC/ETH-only because IvHistoryService only seeds 30d ATM
// for those two underlyings (DVOL coverage). Other assets would need to
// accumulate ~30 days of live snapshots before fits are usable.
export const regimeService = new RegimeService(
  {
    underlyings: ['BTC', 'ETH'],
    store: regimePersistence,
    getRegimeInputs: async (underlying) => buildRegimeInputs(underlying),
  },
  { intervalMs: 5 * 60 * 1000 },
);

interface RegimePersistedHmm {
  nStates: number;
  pi: number[];
  A: number[][];
  mu: number[][];
  sigma2: number[][];
}

interface RegimePersistedStandardization {
  means: number[];
  stds: number[];
}

async function buildRegimeInputs(underlying: string): Promise<RegimeInputs> {
  const ts = Date.now();
  const ivQuery = ivHistoryService.query(underlying, 30).tenors['30d'].current;
  const atmIv30d = ivQuery.atmIv;
  const rr25d_30d = ivQuery.rr25d;
  const bfly25d_30d = ivQuery.bfly25d;

  let basis30d: number | null = null;
  try {
    const entries = await buildIvSurfaceGrid({ underlying });
    const points = entries
      .filter((e) => e.basisPct != null)
      .map((e) => ({ dte: e.dte, basisPct: e.basisPct as number }));
    basis30d = interpBasisToTenor(points, 30);
  } catch {
    // Surface grid fetch failures are non-fatal — feed yields a null-feature
    // snapshot which RegimeService skips without breaking the buffer.
  }

  return { ts, atmIv30d, rr25d_30d, bfly25d_30d, basis30d };
}

let ivHistoryStorageAlarmTimer: ReturnType<typeof setInterval> | null = null;

const serviceHealth = {
  dvol: false,
  spot: false,
  spotCandles: false,
  instrumentCandles: false,
  flow: false,
  blockFlow: false,
  ivHistory: false,
  regime: false,
  news: false,
  dealerBook: false,
};

export function isDvolReady(): boolean {
  return serviceHealth.dvol;
}
export function isSpotReady(): boolean {
  return serviceHealth.spot;
}
export function isSpotCandlesReady(): boolean {
  return serviceHealth.spotCandles;
}
export function isInstrumentCandlesReady(): boolean {
  return serviceHealth.instrumentCandles;
}
export function isFlowReady(): boolean {
  return serviceHealth.flow;
}
export function isBlockFlowReady(): boolean {
  return serviceHealth.blockFlow;
}
export function isIvHistoryReady(): boolean {
  return serviceHealth.ivHistory;
}
export function isRegimeReady(): boolean {
  return serviceHealth.regime;
}
export function isNewsReady(): boolean {
  return serviceHealth.news;
}

let ivHistoryStorageStatsCache: Promise<IvHistoryStorageStats> | null = null;

export function getIvHistoryStorageStats(): Promise<IvHistoryStorageStats> {
  ivHistoryStorageStatsCache ??= loadIvHistoryStorageStats();
  return ivHistoryStorageStatsCache;
}

function loadIvHistoryStorageStats(): Promise<IvHistoryStorageStats> {
  return ivHistoryStore.getStorageStats().catch(() => ({
    enabled: ivHistoryStore.enabled,
    bytes: null,
    thresholdBytes: ivHistorySizeWarnBytes,
    warning: false,
  }));
}

export async function bootstrapServices(log: FastifyBaseLogger) {
  const start = Date.now();
  shortStraddleLog = log;
  shortStraddleSnapshotService?.setLogger(log);
  if (shortStraddleSnapshotsEnabled && !databaseUrl) {
    log.warn({ reason: 'DATABASE_URL missing' }, 'short-straddle snapshot collection disabled');
  }

  // DVOL only exists for BTC and ETH on Deribit — no index for other assets.
  // Flow and spot cover every asset that has options on at least one venue.
  // Keep this list in sync with `UNDERLYINGS`/`SPOT_SYMBOLS` in @oggregator/ingest;
  // both processes maintain independent TradeRuntime instances against the
  // same venue universe.
  const [dvol, spot, flow, blockFlow, spotCandles, instrumentCandles, indexPrice] =
    await Promise.allSettled([
      dvolService.start(['BTC', 'ETH']),
      spotService.start([
        'BTCUSDT',
        'ETHUSDT',
        'SOLUSDT',
        'DOGEUSDT',
        'XRPUSDT',
        'BNBUSDT',
        'AVAXUSDT',
        'TRXUSDT',
        'HYPEUSDT',
        'LTCUSDT',
        'ADAUSDT',
        'TONUSDT',
        'SUIUSDT',
        'XAUTUSDT',
        'AAVEUSDT',
        'ORDIUSDT',
        'WLFIUSDT',
        'ENAUSDT',
        'PENDLEUSDT',
        'TRUMPUSDT',
      ]),
      flowService.start([...FLOW_ALWAYS_ON_UNDERLYINGS]),
      blockFlowService.start(),
      spotCandleService.start(),
      instrumentCandleService.start(),
      indexPriceService.start({
        gateio: true,
        coincallUnderlyings: ['MNT', 'LIT', 'KAS'],
      }),
    ]);

  if (dvol.status === 'fulfilled') {
    serviceHealth.dvol = true;
    log.info('DVOL service started');
  } else log.warn({ err: String(dvol.reason) }, 'DVOL service failed');

  if (spot.status === 'fulfilled') {
    serviceHealth.spot = true;
    log.info('spot service started');
  } else log.warn({ err: String(spot.reason) }, 'spot service failed');

  if (flow.status === 'fulfilled') {
    serviceHealth.flow = true;
    log.info('flow service started');
  } else log.warn({ err: String(flow.reason) }, 'flow service failed');

  if (blockFlow.status === 'fulfilled') {
    serviceHealth.blockFlow = true;
    log.info('block flow service started');
  } else log.warn({ err: String(blockFlow.reason) }, 'block flow service failed');

  if (spotCandles.status === 'fulfilled') {
    serviceHealth.spotCandles = true;
    log.info('spot-candles service started');
  } else log.warn({ err: String(spotCandles.reason) }, 'spot-candles service failed');

  if (instrumentCandles.status === 'fulfilled') {
    serviceHealth.instrumentCandles = true;
    log.info('instrument-candles service started');
  } else log.warn({ err: String(instrumentCandles.reason) }, 'instrument-candles service failed');

  if (indexPrice.status === 'rejected') {
    log.warn({ err: String(indexPrice.reason) }, 'index price runtime failed');
  }

  // IvHistoryService must start AFTER DVOL so seedFromDvol sees candles, and
  // AFTER adapters so the first snapshot's surface grid has chains to read.
  try {
    await ivHistoryService.start();
    serviceHealth.ivHistory = true;
    log.info('IV history service started');
  } catch (err: unknown) {
    log.warn({ err: String(err) }, 'IV history service failed');
  }

  // RegimeService must start AFTER IvHistoryService — it reads the 30d
  // constant-maturity ATM/RR/butterfly from the IV history query result.
  try {
    await regimeService.start();
    serviceHealth.regime = true;
    log.info('regime service started');
  } catch (err: unknown) {
    log.warn({ err: String(err) }, 'regime service failed');
  }

  try {
    await dealerBookService.start();
    serviceHealth.dealerBook = true;
    log.info('dealer book service started');
  } catch (err: unknown) {
    log.warn({ err: String(err) }, 'dealer book service failed');
  }

  startIvHistoryStorageAlarm(log);
  startSettlementJob(log);

  newsService = createNewsRuntimeFromEnv(process.env, log);
  if (newsService) {
    try {
      await newsService.start();
      serviceHealth.news = true;
      log.info('news service started');
    } catch (err: unknown) {
      log.warn({ err: String(err) }, 'news service failed');
    }
  } else {
    log.info('news service disabled (OP_FEED_BASE_URL / OP_FEED_SECRET not set)');
  }

  log.info({ ms: Date.now() - start, health: serviceHealth }, 'services bootstrapped');
}

export function disposeServiceStores(): void {
  if (ivHistoryStorageAlarmTimer) {
    clearInterval(ivHistoryStorageAlarmTimer);
    ivHistoryStorageAlarmTimer = null;
  }
  regimeService.dispose();
  newsService?.dispose();
  disposeSettlementJob();
}

function createOiSnapshotStore(connectionString: string): OiSnapshotStore {
  const postgres = PostgresOiSnapshotStore.fromConnectionString(connectionString);
  if (dealerBookDbFlushIntervalMs === 0) return postgres;
  return new DeferredOiSnapshotStore(
    postgres,
    {
      flushIntervalMs: dealerBookDbFlushIntervalMs,
      cachePath:
        process.env['DEALER_BOOK_OI_CACHE_PATH'] ?? '.cache/dealer-book-oi-snapshots.ndjson',
      maxPendingRows: dealerBookOiCacheMaxRows,
      flushOnDispose: parseBoolean(process.env['DEALER_BOOK_DB_FLUSH_ON_DISPOSE']),
    },
    console,
  );
}

function createDealerBookStore(connectionString: string): DealerBookStore {
  const postgres = PostgresDealerBookStore.fromConnectionString(connectionString);
  if (dealerBookDbFlushIntervalMs === 0) return postgres;
  return new DeferredDealerBookStore(
    postgres,
    {
      flushIntervalMs: dealerBookDbFlushIntervalMs,
      cachePath: process.env['DEALER_BOOK_CACHE_PATH'] ?? '.cache/dealer-book-latest.ndjson',
      maxPendingRows: dealerBookCacheMaxRows,
      flushOnDispose: parseBoolean(process.env['DEALER_BOOK_DB_FLUSH_ON_DISPOSE']),
    },
    console,
  );
}

function createIvHistoryStore(connectionString: string): IvHistoryStore {
  const postgres = PostgresIvHistoryStore.fromConnectionString(
    connectionString,
    ivHistorySizeWarnBytes,
  );
  if (ivHistoryDbFlushIntervalMs === 0) return postgres;
  return new DeferredIvHistoryStore(
    postgres,
    {
      flushIntervalMs: ivHistoryDbFlushIntervalMs,
      cachePath: process.env['IV_HISTORY_CACHE_PATH'] ?? '.cache/iv-history-points.ndjson',
      maxPendingRows: ivHistoryCacheMaxRows,
      thresholdBytes: ivHistorySizeWarnBytes,
      flushOnDispose: parseBoolean(process.env['IV_HISTORY_DB_FLUSH_ON_DISPOSE']),
    },
    console,
  );
}

function createRegimeStore(connectionString: string): RegimeStore {
  const postgres = PostgresRegimeStore.fromConnectionString(connectionString);
  if (regimeDbFlushIntervalMs === 0) return postgres;
  return new DeferredRegimeStore(
    postgres,
    {
      flushIntervalMs: regimeDbFlushIntervalMs,
      observationsCachePath:
        process.env['REGIME_OBSERVATIONS_CACHE_PATH'] ?? '.cache/regime-observations.ndjson',
      modelsCachePath: process.env['REGIME_MODELS_CACHE_PATH'] ?? '.cache/regime-models.ndjson',
      maxPendingRows: regimeObservationsCacheMaxRows,
      flushOnDispose: parseBoolean(process.env['REGIME_DB_FLUSH_ON_DISPOSE']),
    },
    console,
  );
}

function createShortStraddleSnapshotStore(
  connectionString: string,
): DeferredShortStraddleSnapshotStore {
  const postgres = PostgresShortStraddleSnapshotStore.fromConnectionString(connectionString);
  return new DeferredShortStraddleSnapshotStore(
    postgres,
    {
      flushIntervalMs: marketDataDbFlushIntervalMs,
      cachePath:
        process.env['SHORT_STRADDLE_SNAPSHOT_CACHE_PATH'] ??
        '.cache/short-straddle-snapshots.ndjson',
    },
    console,
  );
}

function parseNonNegativeMs(value: string | undefined, fallback: number, envName: string): number {
  if (value == null || value.trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${envName} must be a non-negative integer`);
  }
  return parsed;
}

function parsePositiveInteger(
  value: string | undefined,
  fallback: number,
  envName: string,
): number {
  if (value == null || value.trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${envName} must be a positive integer`);
  }
  return parsed;
}

function parseBoolean(value: string | undefined): boolean {
  return value === '1' || value?.toLowerCase() === 'true';
}

function parseIvHistoryWarnBytes(value: string | undefined): number {
  if (!value) return DEFAULT_IV_HISTORY_SIZE_WARN_BYTES;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_IV_HISTORY_SIZE_WARN_BYTES;
}

function startIvHistoryStorageAlarm(log: FastifyBaseLogger): void {
  if (ivHistoryStorageAlarmTimer || !ivHistoryStore.enabled) return;

  const check = async () => {
    try {
      ivHistoryStorageStatsCache = loadIvHistoryStorageStats();
      const stats = await ivHistoryStorageStatsCache;
      if (!stats.warning || stats.bytes == null) return;
      log.warn(
        { bytes: stats.bytes, thresholdBytes: stats.thresholdBytes },
        'IV history storage size warning',
      );
    } catch (err: unknown) {
      log.warn({ err: String(err) }, 'IV history storage size check failed');
    }
  };

  void check();
  ivHistoryStorageAlarmTimer = setInterval(() => {
    void check();
  }, DAY_MS);
  ivHistoryStorageAlarmTimer.unref?.();
}
