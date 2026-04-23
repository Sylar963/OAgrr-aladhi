import type { FastifyBaseLogger } from 'fastify';
import {
  BlockTradeRuntime,
  DvolService,
  IvHistoryService,
  SpotRuntime,
  TradeRuntime,
  buildIvSurfaceGrid,
} from '@oggregator/core';
import { NoopTradeStore, PostgresTradeStore, type TradeStore } from '@oggregator/db';

export const dvolService = new DvolService();
export const spotService = new SpotRuntime();
export const flowService = new TradeRuntime();
export const blockFlowService = new BlockTradeRuntime();
export const ivHistoryService = new IvHistoryService({
  dvol: dvolService,
  getSurfaceGrid: async (underlying: string) => {
    const entries = await buildIvSurfaceGrid({ underlying });
    return entries.map((e) => e.surfaceRow);
  },
});
export const tradeStore: TradeStore = process.env['DATABASE_URL']
  ? PostgresTradeStore.fromConnectionString(process.env['DATABASE_URL'])
  : new NoopTradeStore();

const serviceHealth = {
  dvol: false,
  spot: false,
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
export function isFlowReady(): boolean {
  return serviceHealth.flow;
}
export function isBlockFlowReady(): boolean {
  return serviceHealth.blockFlow;
}
export function isIvHistoryReady(): boolean {
  return serviceHealth.ivHistory;
}

export async function bootstrapServices(log: FastifyBaseLogger) {
  const start = Date.now();

  // DVOL only exists for BTC and ETH on Deribit — no index for other assets.
  // Flow and spot cover every asset that has options on at least one venue.
  const [dvol, spot, flow, blockFlow] = await Promise.allSettled([
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

  // IvHistoryService must start AFTER DVOL so seedFromDvol sees candles, and
  // AFTER adapters so the first snapshot's surface grid has chains to read.
  try {
    await ivHistoryService.start();
    serviceHealth.ivHistory = true;
    log.info('IV history service started');
  } catch (err: unknown) {
    log.warn({ err: String(err) }, 'IV history service failed');
  }

  log.info({ ms: Date.now() - start, health: serviceHealth }, 'services bootstrapped');
}
