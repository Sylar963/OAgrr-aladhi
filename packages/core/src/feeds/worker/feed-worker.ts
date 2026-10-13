import { parentPort } from 'node:worker_threads';
import type { VenueId } from '../../types/common.js';
import { BinanceWsAdapter } from '../binance/index.js';
import { BybitWsAdapter } from '../bybit/index.js';
import { CoincallWsAdapter } from '../coincall/index.js';
import { DeribitWsAdapter } from '../deribit/index.js';
import { DeriveWsAdapter } from '../derive/index.js';
import { GateioWsAdapter } from '../gateio/index.js';
import { OkxWsAdapter } from '../okx/index.js';
import { ParadexWsAdapter } from '../paradex/index.js';
import { ThalexWsAdapter } from '../thalex/index.js';
import { serveFeedWorker, type WorkerHostedAdapter } from './feed-worker-server.js';

const ADAPTER_FACTORIES: Partial<Record<VenueId, () => WorkerHostedAdapter>> = {
  deribit: () => new DeribitWsAdapter(),
  okx: () => new OkxWsAdapter(),
  binance: () => new BinanceWsAdapter(),
  bybit: () => new BybitWsAdapter(),
  derive: () => new DeriveWsAdapter(),
  coincall: () => new CoincallWsAdapter(),
  thalex: () => new ThalexWsAdapter(),
  gateio: () => new GateioWsAdapter(),
  paradex: () => new ParadexWsAdapter(),
};

if (parentPort == null) {
  throw new Error('feed-worker must be started as a worker thread');
}

serveFeedWorker(parentPort, (venue) => {
  const create = ADAPTER_FACTORIES[venue];
  if (create == null) throw new Error(`feed worker has no adapter for venue ${venue}`);
  return create();
});
