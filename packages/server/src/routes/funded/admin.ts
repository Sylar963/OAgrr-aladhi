import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { fundedEngine } from '../../funded-services.js';

export async function fundedAdminRoute(app: FastifyInstance): Promise<void> {
  app.post('/funded/admin/settle', async (req, reply) => {
    const expected = process.env['FUNDED_ADMIN_TOKEN'];
    if (!expected) {
      return reply
        .status(503)
        .send({ error: 'admin_disabled', message: 'FUNDED_ADMIN_TOKEN not set' });
    }
    const provided = req.headers['x-funded-admin-token'];
    if (typeof provided !== 'string' || !tokensMatch(provided, expected)) {
      return reply.status(401).send({ error: 'unauthorized' });
    }
    const boundary = new Date(
      Date.UTC(
        new Date().getUTCFullYear(),
        new Date().getUTCMonth(),
        new Date().getUTCDate(),
        8,
        0,
        0,
        0,
      ),
    );
    const count = await fundedEngine.settleAllActive(boundary);
    return { settledRuns: count, boundary: boundary.toISOString() };
  });
}

// Hashing first gives equal-length inputs, so timingSafeEqual never throws or leaks the length.
function tokensMatch(provided: string, expected: string): boolean {
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(provided), digest(expected));
}
