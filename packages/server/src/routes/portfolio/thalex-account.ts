import { ThalexAccountResponseSchema } from '@oggregator/protocol';
import { DEFAULT_ACCOUNT_ID } from '@oggregator/trading';
import type { FastifyInstance } from 'fastify';
import { thalexPositionStore } from '../../thalex-position-store.js';
import { getRequestAccountId } from '../../user-service.js';

export async function portfolioThalexAccountRoute(app: FastifyInstance) {
  app.get('/portfolio/thalex/account', async (req, reply) => {
    const accountId = getRequestAccountId(req, DEFAULT_ACCOUNT_ID);
    thalexPositionStore.retain(accountId);
    try {
      const summary = await thalexPositionStore.fetchAccountEquity(accountId);
      const environment = thalexPositionStore.environment(accountId);
      if (summary == null || environment == null) {
        return reply.status(409).send({
          error: 'venue_not_connected',
          message: 'Connect Thalex in Portfolio to load equity.',
        });
      }
      return ThalexAccountResponseSchema.parse({
        accountId,
        venue: 'thalex',
        environment,
        equityUsd: summary.equityUsd,
        freeMarginUsd: summary.remainingMarginUsd,
        initialMarginUsd: summary.requiredMarginUsd,
        unpricedAssets: summary.cash
          .filter((row) => row.balance !== 0 && row.valueUsd == null)
          .map((row) => row.asset),
        updatedAt: summary.updatedAt,
      });
    } catch (error) {
      req.log.warn({ accountId, err: String(error) }, 'thalex account read failed');
      return reply.status(502).send({ error: 'account_unavailable' });
    } finally {
      thalexPositionStore.release(accountId);
    }
  });
}
