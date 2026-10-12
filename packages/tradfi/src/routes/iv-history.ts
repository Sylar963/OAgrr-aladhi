import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { TradfiDeps } from '../app.js';

const RESOLUTION_MS = { '5m': 5 * 60_000, '15m': 15 * 60_000, '1h': 60 * 60_000 } as const;

const QuerySchema = z.object({
  underlying: z.string().min(1),
  window: z.enum(['30d', '90d']).optional(),
  tenor: z.enum(['7d', '30d', '60d', '90d']).optional(),
  resolution: z.enum(['5m', '15m', '1h']).optional(),
});

export function ivHistoryRoute(deps: TradfiDeps) {
  return async function (app: FastifyInstance) {
    app.get('/iv-history/underlyings', async (_req, reply) => {
      if (!deps.ivHistory) return reply.status(503).send({ error: 'IV history not recording' });
      return { underlyings: deps.ivHistory.underlyings };
    });

    app.get('/iv-history', async (req, reply) => {
      const history = deps.ivHistory;
      if (!history) return reply.status(503).send({ error: 'IV history not recording' });
      const parsed = QuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'invalid query', issues: parsed.error.issues });
      }
      const { underlying: raw, window, tenor, resolution } = parsed.data;
      const underlying = raw.toUpperCase();
      if (!history.underlyings.includes(underlying)) {
        return reply.status(404).send({ error: `IV history is not recorded for ${underlying}` });
      }
      return history.service.query(underlying, window === '90d' ? 90 : 30, {
        ...(tenor && { seriesTenor: tenor }),
        ...(resolution && { resolutionMs: RESOLUTION_MS[resolution] }),
      });
    });
  };
}
