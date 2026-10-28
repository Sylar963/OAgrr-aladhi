import type { FastifyInstance } from 'fastify';
import { isReady } from '../app.js';
import { alphaIronFlyScannerRoute } from './alpha-iron-fly-scanner.js';
import { alphaMarketContextRoute } from './alpha-market-context.js';
import { alphaLottoScannerRoute } from './alpha-lotto-scanner.js';
import { alphaPutScannerRoute } from './alpha-put-scanner.js';
import { alphaShortStraddleEvaluationRoute } from './alpha-short-straddle-evaluation.js';
import { alphaStraddleScannerRoute } from './alpha-straddle-scanner.js';
import { blockFlowRoute } from './block-flow.js';
import { blockStrikeBucketsRoute } from './block-strike-buckets.js';
import { callPutFlowRoute } from './call-put-flow.js';
import { chainsRoute } from './chains.js';
import { dvolHistoryRoute } from './dvol-history.js';
import { volHeatmapRoute } from './vol-heatmap.js';
import { expiriesRoute } from './expiries.js';
import { flowRoute } from './flow.js';
import { flowEvidenceRoute } from './flow-evidence.js';
import { fundedRoutes } from './funded/index.js';
import { gexAllExpiriesRoute } from './gex-all-expiries.js';
import { gexWallHistoryRoute } from './gex-wall-history.js';
import { breakEvenRoute } from './break-even.js';
import { healthRoute } from './health.js';
import { instrumentCandlesRoute } from './instrument-candles.js';
import { ivHistoryRoute } from './iv-history.js';
import { leadsRoute } from './leads.js';
import { newsRoute } from './news.js';
import { paperAuthRoute } from './paper/auth.js';
import { paperRoutes, paperWsRoute } from './paper/index.js';
import { portfolioRoutes, portfolioWsRoute } from './portfolio/index.js';
import { regimeRoute } from './regime.js';
import { socialRoutes, socialWsRoute } from './social/index.js';
import { ExecutionClient } from '../execution-client.js';
import { portfolioAssistantStore } from '../portfolio-assistant-services.js';
import { authenticateRequest } from '../user-service.js';
import { cspReportRoute } from './csp-report.js';
import { liveRoutes } from './live/index.js';
import { liquidityRoute } from './liquidity.js';
import { orderBookRuntime } from '../services.js';
import { sectorsRoute } from './sectors.js';
import { spotCandlesRoute } from './spot-candles.js';
import { spotsRoute } from './spots.js';
import { statsRoute } from './stats.js';
import { surfaceRoute } from './surface.js';
import { thesisRoutes } from './thesis.js';
import { thesisService } from '../thesis-services.js';
import { isSocialEnabled, socialProfileService, socialThesisFeed } from '../social-services.js';
import { timeAtPriceRoute } from './time-at-price.js';
import { underlyingsRoute } from './underlyings.js';
import { venuesRoute } from './venues.js';
import { volRichnessRoute } from './vol-richness.js';
import { wsChainRoute } from './ws-chain.js';
import { wsInstrumentTradesRoute } from './ws-instrument-trades.js';

export function shouldBlockApiRequestWhileBootstrapping(url: string): boolean {
  if (!url.startsWith('/api/')) return false;
  if (url.startsWith('/api/paper/auth/')) return false;
  // The kill switch must work while market data is still loading.
  if (url.startsWith('/api/live/')) return false;
  if (url.startsWith('/api/csp-report')) return false;
  if (
    url === '/api/portfolio/venue-credentials' ||
    url.startsWith('/api/portfolio/venue-credentials/')
  ) {
    return false;
  }
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
  app.register(cspReportRoute, { prefix: '/api' });
  app.register(venuesRoute, { prefix: '/api' });
  app.register(volRichnessRoute, { prefix: '/api' });
  app.register(alphaMarketContextRoute, { prefix: '/api' });
  app.register(alphaLottoScannerRoute, { prefix: '/api' });
  app.register(alphaPutScannerRoute, { prefix: '/api' });
  app.register(alphaShortStraddleEvaluationRoute, { prefix: '/api' });
  app.register(alphaStraddleScannerRoute, { prefix: '/api' });
  app.register(alphaIronFlyScannerRoute, { prefix: '/api' });
  app.register(underlyingsRoute, { prefix: '/api' });
  app.register(sectorsRoute, { prefix: '/api' });
  app.register(expiriesRoute, { prefix: '/api' });
  app.register(chainsRoute, { prefix: '/api' });
  app.register(gexAllExpiriesRoute, { prefix: '/api' });
  app.register(gexWallHistoryRoute, { prefix: '/api' });
  app.register(breakEvenRoute, { prefix: '/api' });
  app.register(timeAtPriceRoute, { prefix: '/api' });
  app.register(surfaceRoute, { prefix: '/api' });
  app.register(statsRoute, { prefix: '/api' });
  app.register(flowRoute, { prefix: '/api' });
  app.register(flowEvidenceRoute, { prefix: '/api' });
  app.register(blockFlowRoute, { prefix: '/api' });
  app.register(blockStrikeBucketsRoute, { prefix: '/api' });
  app.register(callPutFlowRoute, { prefix: '/api' });
  app.register(dvolHistoryRoute, { prefix: '/api' });
  app.register(volHeatmapRoute, { prefix: '/api' });
  app.register(liquidityRoute, { prefix: '/api', runtime: orderBookRuntime });
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
  app.register(
    thesisRoutes(thesisService, {
      blocker: async (user) => {
        if (!isSocialEnabled()) return 'Social features need DATABASE_URL';
        const profile = await socialProfileService.sync(user);
        return profile.handle ? null : 'Set a username on your account to share theses';
      },
      changed: () => socialThesisFeed.invalidate(),
    }),
    { prefix: '/api' },
  );
  app.register(fundedRoutes, { prefix: '/api' });
  app.register(socialRoutes, { prefix: '/api' });
  app.register(liveRoutes, {
    prefix: '/api',
    env: process.env,
    client: ExecutionClient.fromEnv(process.env),
    authenticate: authenticateRequest,
    entitlements: portfolioAssistantStore,
  });
  app.register(wsChainRoute);
  app.register(wsInstrumentTradesRoute);
  app.register(paperWsRoute);
  app.register(portfolioWsRoute);
  app.register(socialWsRoute);
}
