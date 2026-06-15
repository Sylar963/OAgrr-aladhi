import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import type { TradfiStore } from './runtime/store.js';
import { venuesRoute } from './routes/venues.js';
import { underlyingsRoute } from './routes/underlyings.js';
import { expiriesRoute } from './routes/expiries.js';
import { chainsRoute } from './routes/chains.js';

export interface FeedLike {
  isLoaded(): boolean;
  refreshChainQuotes(underlying: string, expiry: string): Promise<void>;
}

export interface TradfiDeps {
  store: TradfiStore;
  feed: FeedLike;
}

export function buildApp(deps: TradfiDeps): FastifyInstance {
  const app = Fastify({ logger: false });
  void app.register(cors, { origin: true });
  void app.register(venuesRoute);
  void app.register(underlyingsRoute(deps));
  void app.register(expiriesRoute(deps));
  void app.register(chainsRoute(deps));
  return app;
}
