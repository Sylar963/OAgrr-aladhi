import type { VenueMarginResponse } from '@oggregator/protocol';
import { DEFAULT_ACCOUNT_ID } from '@oggregator/trading';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { thalexPositionStore } from '../../thalex-position-store.js';
import { getRequestAccountId } from '../../user-service.js';

const VenueMarginQuerySchema = z.object({ venue: z.literal('thalex') });

export async function portfolioVenueMarginRoute(app: FastifyInstance) {
  app.get('/portfolio/venue-margin', async (req, reply) => {
    const parsed = VenueMarginQuerySchema.safeParse(req.query);
    if (!parsed.success) return reply.status(400).send({ error: 'invalid_venue' });
    const accountId = getRequestAccountId(req, DEFAULT_ACCOUNT_ID);
    const margin = thalexPositionStore.getMargin(accountId);
    if (margin === undefined) {
      return reply.status(409).send({
        error: 'venue_not_connected',
        message: 'Sign in to thalex to see account margin.',
      });
    }
    if (margin === null) {
      return reply.status(503).send({
        error: 'margin_unavailable',
        message: 'Thalex has not reported account margin yet.',
      });
    }
    const response: VenueMarginResponse = { accountId, venue: 'thalex', ...margin };
    return response;
  });
}
