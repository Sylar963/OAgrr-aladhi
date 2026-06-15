import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import type { TradfiStore } from './runtime/store.js';
import { venuesRoute } from './routes/venues.js';
import { underlyingsRoute } from './routes/underlyings.js';
import { expiriesRoute } from './routes/expiries.js';
import { chainsRoute } from './routes/chains.js';
import { wsChainRoute } from './routes/ws-chain.js';

export interface FeedLike {
  isLoaded(): boolean;
}

export interface TradfiDeps {
  store: TradfiStore;
  feed: FeedLike;
}

export function buildApp(deps: TradfiDeps): FastifyInstance {
  const app = Fastify({ logger: false });
  void app.register(cors, { origin: true });
  void app.register(websocket);
  void app.register(venuesRoute);
  void app.register(underlyingsRoute(deps));
  void app.register(expiriesRoute(deps));
  void app.register(chainsRoute(deps));
  void app.register(wsChainRoute(deps));
  return app;
}
