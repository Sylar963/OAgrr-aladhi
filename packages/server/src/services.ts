import type { FastifyBaseLogger } from 'fastify';
import {
  BlockTradeRuntime,
  DvolService,
  IvHistoryService,
  SpotCandleService,
  SpotRuntime,
  TradeRuntime,
  buildIvSurfaceGrid,
} from '@oggregator/core';
import {
  DEFAULT_IV_HISTORY_SIZE_WARN_BYTES,
  NoopIvHistoryStore,
  NoopTradeStore,
  PostgresIvHistoryStore,
  PostgresTradeStore,
  type IvHistoryStorageStats,
  type IvHistoryStore,
  type TradeStore,
} from '@oggregator/db';
import { disposeSettlementJob, startSettlementJob } from './settlement-service.js';

export const dvolService = new DvolService();
export const spotService = new SpotRuntime();
export const spotCandleService = new SpotCandleService();
export const flowService = new TradeRuntime();
export const blockFlowService = new BlockTradeRuntime();
const databaseUrl = process.env['DATABASE_URL'];
const ivHistorySizeWarnBytes = parseIvHistoryWarnBytes(
  process.env['IV_HISTORY_SIZE_WARN_BYTES'],
);
export const ivHistoryStore: IvHistoryStore = databaseUrl
  ? PostgresIvHistoryStore.fromConnectionString(databaseUrl, ivHistorySizeWarnBytes)
  : new NoopIvHistoryStore(ivHistorySizeWarnBytes);
export const ivHistoryService = new IvHistoryService({
  dvol: dvolService,
  store: ivHistoryStore,
  getSurfaceGrid: async (underlying: string) => {
    const entries = await buildIvSurfaceGrid({ underlying });
    return entries.map((e) => e.surfaceRow);
  },
});
export const tradeStore: TradeStore = databaseUrl
  ? PostgresTradeStore.fromConnectionString(databaseUrl)
  : new NoopTradeStore();

let ivHistoryStorageAlarmTimer: ReturnType<typeof setInterval> | null = null;

const serviceHealth = {
  dvol: false,
  spot: false,
  spotCandles: false,
  flow: false,
  blockFlow: false,
  ivHistory: false,
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
export function isFlowReady(): boolean {
  return serviceHealth.flow;
}
export function isBlockFlowReady(): boolean {
  return serviceHealth.blockFlow;
}
export function isIvHistoryReady(): boolean {
  return serviceHealth.ivHistory;
}

export async function getIvHistoryStorageStats(): Promise<IvHistoryStorageStats> {
  try {
    return await ivHistoryStore.getStorageStats();
  } catch {
    return {
      enabled: ivHistoryStore.enabled,
      bytes: null,
      thresholdBytes: ivHistorySizeWarnBytes,
      warning: false,
    };
  }
}

export async function bootstrapServices(log: FastifyBaseLogger) {
  const start = Date.now();

  // DVOL only exists for BTC and ETH on Deribit — no index for other assets.
  // Flow and spot cover every asset that has options on at least one venue.
  const [dvol, spot, flow, blockFlow, spotCandles] = await Promise.allSettled([
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
    ]),
    flowService.start(['BTC', 'ETH', 'SOL', 'DOGE', 'XRP', 'BNB', 'AVAX', 'TRX', 'HYPE']),
    blockFlowService.start(),
    spotCandleService.start(),
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

  // IvHistoryService must start AFTER DVOL so seedFromDvol sees candles, and
  // AFTER adapters so the first snapshot's surface grid has chains to read.
  try {
    await ivHistoryService.start();
    serviceHealth.ivHistory = true;
    log.info('IV history service started');
  } catch (err: unknown) {
    log.warn({ err: String(err) }, 'IV history service failed');
  }

  startIvHistoryStorageAlarm(log);
  startSettlementJob(log);

  log.info({ ms: Date.now() - start, health: serviceHealth }, 'services bootstrapped');
}

export function disposeServiceStores(): void {
  if (ivHistoryStorageAlarmTimer) {
    clearInterval(ivHistoryStorageAlarmTimer);
    ivHistoryStorageAlarmTimer = null;
  }
  disposeSettlementJob();
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
      const stats = await ivHistoryStore.getStorageStats();
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
  }, 5 * 60 * 1000);
  ivHistoryStorageAlarmTimer.unref?.();
}
