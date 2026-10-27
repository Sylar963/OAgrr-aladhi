import type { FastifyInstance } from 'fastify';
import { FlowEvidenceResponseSchema, FlowEvidenceQuerySchema } from '@oggregator/protocol';
import { flowEvidenceService } from '../services.js';

export async function flowEvidenceRoute(app: FastifyInstance) {
  app.get('/flow/evidence', async (request, reply) => {
    const query = FlowEvidenceQuerySchema.safeParse(request.query);
    if (!query.success) return reply.status(400).send({ error: 'invalid_query' });
    const result = await flowEvidenceService.get(query.data);
    if (!result) return reply.status(404).send({ error: 'trade_not_found' });
    return FlowEvidenceResponseSchema.parse(result);
  });
}
