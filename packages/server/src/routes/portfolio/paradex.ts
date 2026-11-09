import { ParadexAuthError } from '@oggregator/core';
import { ParadexAccountResponseSchema, ParadexRfqsResponseSchema } from '@oggregator/protocol';
import { DEFAULT_ACCOUNT_ID } from '@oggregator/trading';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';

import { paradexPositionStore } from '../../paradex-position-store.js';
import { getRequestAccountId } from '../../user-service.js';

const RfqsQuerySchema = z.object({
  underlying: z.string().regex(/^[A-Z0-9]{1,20}$/),
  cursor: z.string().min(1).max(4096).optional(),
});

function unavailable(reply: FastifyReply) {
  return reply.status(409).send({
    error: 'venue_not_connected',
    message: 'Connect Paradex in Portfolio to load equity and RFQs.',
  });
}

export async function portfolioParadexRoutes(app: FastifyInstance) {
  app.get('/portfolio/paradex/account', async (req, reply) => {
    const accountId = getRequestAccountId(req, DEFAULT_ACCOUNT_ID);
    paradexPositionStore.retain(accountId);
    try {
      const summary = await paradexPositionStore.fetchAccountSummary(accountId);
      if (summary == null) return unavailable(reply);
      return ParadexAccountResponseSchema.parse({ accountId, venue: 'paradex', ...summary });
    } catch (error) {
      req.log.warn({ accountId, err: String(error) }, 'paradex account read failed');
      return reply.status(error instanceof ParadexAuthError ? 409 : 502).send({
        error: error instanceof ParadexAuthError ? 'venue_auth_rejected' : 'account_unavailable',
      });
    } finally {
      paradexPositionStore.release(accountId);
    }
  });

  app.get('/portfolio/paradex/rfqs', async (req, reply) => {
    const query = RfqsQuerySchema.safeParse(req.query);
    if (!query.success) return reply.status(400).send({ error: 'invalid_query' });
    const accountId = getRequestAccountId(req, DEFAULT_ACCOUNT_ID);
    paradexPositionStore.retain(accountId);
    try {
      const page = await paradexPositionStore.fetchOpenRfqs(accountId, query.data.underlying, query.data.cursor);
      if (page == null) return unavailable(reply);
      return ParadexRfqsResponseSchema.parse({ accountId, venue: 'paradex', ...page });
    } catch (error) {
      req.log.warn({ accountId, err: String(error) }, 'paradex RFQ read failed');
      return reply.status(error instanceof ParadexAuthError ? 409 : 502).send({
        error: error instanceof ParadexAuthError ? 'venue_auth_rejected' : 'rfqs_unavailable',
      });
    } finally {
      paradexPositionStore.release(accountId);
    }
  });
}
