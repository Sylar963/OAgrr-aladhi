import type { FastifyInstance } from 'fastify';
import { resolveSettlementSpot } from '../../settlement-service.js';
import { paperTradingStore } from '../../trading-services.js';
import { AccountScopeError, authorizeAccountScope } from '../../user-service.js';
import { settleExpiredPositionsForAccount } from './workspace.js';

// Triggers an on-demand settlement scan for the requesting user's account.
// The daily 08:05-UTC cron remains the global mechanism; this endpoint is for
// dashboards/tests that want immediate settlement after manually backdating a
// position's expiry. Shares resolveSettlementSpot with the cron so the
// gateio-first → spot-runtime-fallback order is identical on both paths.
export async function paperSettleRoute(app: FastifyInstance) {
  app.post<{
    Querystring: { accountId?: string };
  }>('/paper/settle-now', async (req, reply) => {
    if (!paperTradingStore.enabled) {
      return reply.status(503).send({ error: 'persistence_unavailable' });
    }
    let accountId: string;
    try {
      accountId = await authorizeAccountScope(req, req.query.accountId);
    } catch (err) {
      if (err instanceof AccountScopeError) {
        return reply.status(err.statusCode).send({ error: 'forbidden', message: err.message });
      }
      throw err;
    }
    const asOf = new Date();

    const result = await settleExpiredPositionsForAccount(accountId, asOf, {
      resolveSpot: (underlying, expiry) => resolveSettlementSpot(underlying, expiry, asOf, req.log),
      log: req.log,
    });

    return {
      fillsCount: result.fillsCount,
      settledTradeIds: result.settledTradeIds,
      skipped: result.skipped,
    };
  });
}
