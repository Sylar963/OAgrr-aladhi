import { VolRichnessQuerySchema, type VolRichness } from '@oggregator/protocol';
import type { FastifyInstance } from 'fastify';

import { volRichnessSource } from '../services.js';

export async function volRichnessRoute(app: FastifyInstance) {
  app.get<{ Querystring: { underlying?: string } }>(
    '/vol-richness',
    async (req, reply): Promise<VolRichness | { error: string; details?: unknown }> => {
      const parsed = VolRichnessQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return reply.status(400).send({
          error: 'invalid vol richness query',
          details: parsed.error.flatten(),
        });
      }
      const richness = await volRichnessSource.get(parsed.data.underlying, req.log);
      if (richness == null) {
        return reply.status(404).send({ error: 'vol richness unavailable for this underlying' });
      }
      return richness;
    },
  );
}
