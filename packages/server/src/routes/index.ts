import type { FastifyInstance } from 'fastify';
import { isReady } from '../app.js';
import { blockFlowRoute } from './block-flow.js';
import { chainsRoute } from './chains.js';
import { dvolHistoryRoute } from './dvol-history.js';
import { expiriesRoute } from './expiries.js';
import { flowRoute } from './flow.js';
import { fundedRoutes } from './funded/index.js';
import { gexAllExpiriesRoute } from './gex-all-expiries.js';
import { healthRoute } from './health.js';
import { instrumentCandlesRoute } from './instrument-candles.js';
import { ivHistoryRoute } from './iv-history.js';
import { leadsRoute } from './leads.js';
import { newsRoute } from './news.js';
import { paperAuthRoute } from './paper/auth.js';
import { paperRoutes, paperWsRoute } from './paper/index.js';
import { portfolioRoutes, portfolioWsRoute } from './portfolio/index.js';
import { regimeRoute } from './regime.js';
import { spotCandlesRoute } from './spot-candles.js';
import { spotsRoute } from './spots.js';
import { statsRoute } from './stats.js';
import { surfaceRoute } from './surface.js';
import { underlyingsRoute } from './underlyings.js';
import { venuesRoute } from './venues.js';
import { wsChainRoute } from './ws-chain.js';

export function shouldBlockApiRequestWhileBootstrapping(url: string): boolean {
  if (!url.startsWith('/api/')) return false;
  return url !== '/api/health' && url !== '/api/ready';
}

export function registerRoutes(app: FastifyInstance) {
  app.addHook('onRequest', async (_req, reply) => {
    if (!isReady() && shouldBlockApiRequestWhileBootstrapping(_req.url)) {
      return reply
        .status(503)
        .send({ error: 'initializing', message: 'Server is loading market data' });
    }
  });

  app.register(healthRoute, { prefix: '/api' });
  app.register(venuesRoute, { prefix: '/api' });
  app.register(underlyingsRoute, { prefix: '/api' });
  app.register(expiriesRoute, { prefix: '/api' });
  app.register(chainsRoute, { prefix: '/api' });
  app.register(gexAllExpiriesRoute, { prefix: '/api' });
  app.register(surfaceRoute, { prefix: '/api' });
  app.register(statsRoute, { prefix: '/api' });
  app.register(flowRoute, { prefix: '/api' });
  app.register(blockFlowRoute, { prefix: '/api' });
  app.register(dvolHistoryRoute, { prefix: '/api' });
  app.register(spotCandlesRoute, { prefix: '/api' });
  app.register(instrumentCandlesRoute, { prefix: '/api' });
  app.register(ivHistoryRoute, { prefix: '/api' });
  app.register(regimeRoute, { prefix: '/api' });
  app.register(newsRoute, { prefix: '/api' });
  app.register(spotsRoute, { prefix: '/api' });
  app.register(leadsRoute, { prefix: '/api' });
  app.register(paperRoutes, { prefix: '/api' });
  app.register(paperAuthRoute, { prefix: '/api' });
  app.register(portfolioRoutes, { prefix: '/api' });
  app.register(fundedRoutes, { prefix: '/api' });
  app.register(wsChainRoute);
  app.register(paperWsRoute);
  app.register(portfolioWsRoute);
}
