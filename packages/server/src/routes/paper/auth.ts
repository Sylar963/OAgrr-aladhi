import type { FastifyInstance } from 'fastify';
import { syncUser } from '../../user-service.js';

function bearerToken(authorization: string | undefined): string | null {
  if (typeof authorization !== 'string') return null;
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  return match ? match[1]! : null;
}

export async function paperAuthRoute(app: FastifyInstance) {
  // Called once by the SPA after Clerk sign-in: verifies the Clerk token,
  // upserts the users row, ensures a paper account, returns its id.
  app.post('/paper/auth/sync', async (req, reply) => {
    const token = bearerToken(req.headers.authorization);
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
      req.log.error({ err: String(error) }, 'paper auth sync failed');
      return reply.status(500).send({ error: 'internal_error', message: 'Failed to sync user' });
    }
  });
}
