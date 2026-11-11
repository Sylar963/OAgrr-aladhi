import type { FastifyInstance } from 'fastify';

import { DEFAULT_ACCOUNT_ID } from '@oggregator/trading';

import { getRequestAccountId, requireUser } from '../../user-service.js';
import { portfolioAssistantRoutes } from './assistant.js';
import { portfolioEquityHistoryRoute } from './equity-history.js';
import { portfolioParadexRoutes } from './paradex.js';
import { portfolioThalexAccountRoute } from './thalex-account.js';
import { portfolioMetricsRoute } from './metrics.js';
import { portfolioPositionsRoute } from './positions.js';
import { portfolioScenariosRoute } from './scenarios.js';
import { portfolioTradesRoute } from './trades.js';
import { ensureParadexConnected, portfolioVenueCredentialsRoute } from './venue-credentials.js';
import { portfolioVenueMarginRoute } from './venue-margin.js';
import { portfolioWsRoute } from './ws.js';

export async function portfolioRoutes(app: FastifyInstance) {
  app.addHook('onRequest', requireUser());
  app.addHook('preHandler', async (req, reply) => {
    if (req.method !== 'GET') return;
    const url = new URL(req.url, 'http://localhost');
    const paradexRead =
      url.pathname.includes('/portfolio/paradex/') ||
      url.searchParams.get('source') === 'paradex' ||
      (url.pathname.endsWith('/portfolio/equity-history') &&
        url.searchParams.get('venue') === 'paradex');
    if (!paradexRead) return;
    try {
      if (!(await ensureParadexConnected(getRequestAccountId(req, DEFAULT_ACCOUNT_ID)))) {
        return reply.status(409).send({
          error: 'venue_not_connected',
          message: 'Reconnect Paradex in Portfolio to load your account.',
        });
      }
    } catch (error) {
      req.log.warn({ err: String(error) }, 'paradex connection restore failed');
      return reply.status(502).send({ error: 'venue_connection_unavailable' });
    }
  });
  await portfolioPositionsRoute(app);
  await portfolioMetricsRoute(app);
  await portfolioScenariosRoute(app);
  await portfolioTradesRoute(app);
  await portfolioEquityHistoryRoute(app);
  await portfolioVenueMarginRoute(app);
  await portfolioParadexRoutes(app);
  await portfolioThalexAccountRoute(app);
  await portfolioVenueCredentialsRoute(app);
  await portfolioAssistantRoutes(app);
}

export { portfolioWsRoute };
