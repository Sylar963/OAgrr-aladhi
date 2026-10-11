import { type BreakEvenResponse, BreakEvenQuerySchema } from '@oggregator/protocol';
import type { FastifyInstance } from 'fastify';
import { ResponseCache } from '../response-cache.js';
import { breakEvenService } from '../services.js';

const breakEvenCache = new ResponseCache<BreakEvenResponse | null>(15_000, 64);

export async function breakEvenRoute(app: FastifyInstance) {
  app.get<{ Querystring: { underlying?: string; expiry?: string } }>(
    '/break-even',
    async (req, reply): Promise<BreakEvenResponse | { error: string; details?: unknown }> => {
      const parsed = BreakEvenQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return reply.status(400).send({
          error: 'invalid break-even query',
          details: parsed.error.flatten(),
        });
      }
      const { underlying, expiry } = parsed.data;
      const result = await breakEvenCache.get(`${underlying}:${expiry}`, () =>
        breakEvenService.query(underlying, expiry),
      );
      if (result == null) {
        return reply.status(404).send({ error: 'no Deribit marks for this expiry' });
      }
      return result;
    },
  );
}
