import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { isIvHistoryReady, ivHistoryService } from '../services.js';

const RESOLUTION_MS = { '5m': 5 * 60_000, '15m': 15 * 60_000, '1h': 60 * 60_000 } as const;

const QuerySchema = z.object({
  underlying: z.string().optional(),
  window: z.string().optional(),
  tenor: z.enum(['7d', '30d', '60d', '90d']).optional(),
  resolution: z.enum(['5m', '15m', '1h']).optional(),
});

export async function ivHistoryRoute(app: FastifyInstance) {
  app.get('/iv-history', async (req, reply) => {
    if (!isIvHistoryReady()) {
      return reply.status(503).send({ error: 'IV history service not available' });
    }

    const parsed = QuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid query', issues: parsed.error.issues });
    }
    const query = parsed.data;
    const underlying = (query.underlying ?? 'BTC').toUpperCase();
    const windowDays = query.window === '90d' ? 90 : 30;

    return ivHistoryService.query(underlying, windowDays, {
      ...(query.tenor && { seriesTenor: query.tenor }),
      ...(query.resolution && { resolutionMs: RESOLUTION_MS[query.resolution] }),
    });
  });
}
