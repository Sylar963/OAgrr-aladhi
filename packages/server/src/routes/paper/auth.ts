import type { FastifyInstance } from 'fastify';

import { derivePositionStore } from '../../derive-position-store.js';
import { thalexPositionStore } from '../../thalex-position-store.js';
import { revokePrivateWebSockets } from '../../websocket-security.js';
import { getUserByToken, syncUser } from '../../user-service.js';
import {
  invalidateWebSocketTicketsForUser,
  issueWebSocketTicket,
} from '../../websocket-ticket-service.js';

function bearerToken(authorization: string | undefined): string | null {
  if (typeof authorization !== 'string') return null;
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  return match ? match[1]! : null;
}

export async function paperAuthRoute(app: FastifyInstance) {
  const authLimit = { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } };
  app.post('/paper/auth/sync', authLimit, async (request, reply) => {
    const token = bearerToken(request.headers.authorization);
    try {
      const result = await syncUser(token);
      if (!result) {
        return reply.status(401).send({
          error: 'unauthorized',
          message: 'Invalid or missing Authorization bearer token',
        });
      }
      return reply.send(result);
    } catch (error) {
      request.log.error({ err: String(error) }, 'paper auth sync failed');
      return reply.status(500).send({ error: 'internal_error', message: 'Failed to sync user' });
    }
  });

  app.post('/paper/auth/ws-ticket', authLimit, async (request, reply) => {
    const user = await getUserByToken(bearerToken(request.headers.authorization));
    if (!user) {
      return reply.status(401).send({
        error: 'unauthorized',
        message: 'Invalid or missing Authorization bearer token',
      });
    }
    return issueWebSocketTicket(user);
  });

  app.delete('/paper/auth/session', authLimit, async (request, reply) => {
    const user = await getUserByToken(bearerToken(request.headers.authorization));
    if (!user) {
      return reply.status(401).send({
        error: 'unauthorized',
        message: 'Invalid or missing Authorization bearer token',
      });
    }
    invalidateWebSocketTicketsForUser(user.id);
    revokePrivateWebSockets(user.id);
    await Promise.allSettled([
      derivePositionStore.disconnect(user.accountId),
      thalexPositionStore.disconnect(user.accountId),
    ]);
    return reply.status(204).send();
  });
}
