import type { FastifyBaseLogger } from 'fastify';
import { DvolService, SpotService, FlowService } from '@oggregator/core';

export const dvolService = new DvolService();
export const spotService = new SpotService();
export const flowService = new FlowService();

const serviceHealth = { dvol: false, spot: false, flow: false };

export function isDvolReady(): boolean { return serviceHealth.dvol; }
export function isSpotReady(): boolean { return serviceHealth.spot; }
export function isFlowReady(): boolean { return serviceHealth.flow; }

export async function bootstrapServices(log: FastifyBaseLogger) {
  const start = Date.now();

  const [dvol, spot, flow] = await Promise.allSettled([
    dvolService.start(['BTC', 'ETH']),
    spotService.start(['BTCUSDT', 'ETHUSDT', 'SOLUSDT']),
    flowService.start(['BTC', 'ETH']),
  ]);

  if (dvol.status === 'fulfilled') { serviceHealth.dvol = true; log.info('DVOL service started'); }
  else log.warn({ err: String(dvol.reason) }, 'DVOL service failed');

  if (spot.status === 'fulfilled') { serviceHealth.spot = true; log.info('spot service started'); }
  else log.warn({ err: String(spot.reason) }, 'spot service failed');

  if (flow.status === 'fulfilled') { serviceHealth.flow = true; log.info('flow service started'); }
  else log.warn({ err: String(flow.reason) }, 'flow service failed');

  log.info({ ms: Date.now() - start, health: serviceHealth }, 'services bootstrapped');
}
