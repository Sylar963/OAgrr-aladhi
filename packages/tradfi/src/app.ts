import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import type { TradfiStore } from './runtime/store.js';
import type { TradfiReadiness } from './tastytrade/feed.js';
import type { CandleClient } from './tastytrade/candle-client.js';
import { venuesRoute } from './routes/venues.js';
import { healthRoute } from './routes/health.js';
import { underlyingsRoute } from './routes/underlyings.js';
import { expiriesRoute } from './routes/expiries.js';
import { chainsRoute } from './routes/chains.js';
import { wsChainRoute } from './routes/ws-chain.js';
import { candlesRoute } from './routes/candles.js';

export interface FeedLike {
  readiness(): TradfiReadiness;
  ensureChainSubscribed(underlying: string, expiry: string): void;
  refreshChainQuotes(underlying: string, expiry: string): Promise<number>;
}

export interface TradfiDeps {
  store: TradfiStore;
  feed: FeedLike;
  candleClient?: CandleClient;
}

export function buildApp(deps: TradfiDeps): FastifyInstance {
  const app = Fastify({ logger: false });
  void app.register(cors, { origin: true });
  void app.register(websocket);
  void app.register(venuesRoute);
  void app.register(healthRoute(deps));
  void app.register(underlyingsRoute(deps));
  void app.register(expiriesRoute(deps));
  void app.register(chainsRoute(deps));
  void app.register(wsChainRoute(deps));
  void app.register(candlesRoute(deps));
  return app;
}
