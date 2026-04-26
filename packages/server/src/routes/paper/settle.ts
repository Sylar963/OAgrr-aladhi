import type { FastifyInstance } from 'fastify';
import { DEFAULT_ACCOUNT_ID } from '@oggregator/trading';
import { paperTradingStore } from '../../trading-services.js';
import { spotService } from '../../services.js';
import { settleExpiredPositionsForAccount } from './workspace.js';

// Triggers an on-demand settlement scan for the requesting user's account.
// The daily 08:05-UTC cron remains the global mechanism; this endpoint is for
// dashboards/tests that want immediate settlement after manually backdating a
// position's expiry.
export async function paperSettleRoute(app: FastifyInstance) {
  app.post('/paper/settle-now', async (req, reply) => {
    if (!paperTradingStore.enabled) {
      return reply.status(503).send({ error: 'persistence_unavailable' });
    }
    const accountId = req.user?.accountId ?? DEFAULT_ACCOUNT_ID;
    const asOf = new Date();

    const result = await settleExpiredPositionsForAccount(accountId, asOf, {
      resolveSpot: async (underlying, expiry) => {
        const cached = await paperTradingStore.getSettlementPrice(underlying, expiry);
        if (cached) return cached.priceUsd;
        const snap = spotService.getSnapshot(underlying);
        if (!snap || !Number.isFinite(snap.lastPrice) || snap.lastPrice <= 0) {
          return null;
        }
        await paperTradingStore.upsertSettlementPrice({
          underlying,
          expiry,
          priceUsd: snap.lastPrice,
          source: 'spot-runtime',
          capturedAt: asOf,
        });
        return snap.lastPrice;
      },
      log: req.log,
    });

    return {
      fillsCount: result.fillsCount,
      settledTradeIds: result.settledTradeIds,
      skipped: result.skipped,
    };
  });
}
