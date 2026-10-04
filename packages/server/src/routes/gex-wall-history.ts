import { type GexWallHistoryResponse, GexWallHistoryQuerySchema } from '@oggregator/protocol';
import type { FastifyInstance } from 'fastify';
import { gexWallHistoryService } from '../services.js';

export async function gexWallHistoryRoute(app: FastifyInstance) {
  app.get<{ Querystring: { underlying?: string; days?: string } }>(
    '/gex-wall-history',
    async (req, reply): Promise<GexWallHistoryResponse | { error: string; details?: unknown }> => {
      const parsed = GexWallHistoryQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return reply.status(400).send({
          error: 'invalid gex wall history query',
          details: parsed.error.flatten(),
        });
      }
      return gexWallHistoryService.query(parsed.data.underlying, parsed.data.days);
    },
  );
}
