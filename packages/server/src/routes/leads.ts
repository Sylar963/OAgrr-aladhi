import { LeadCaptureRequestSchema } from '@oggregator/protocol';
import type { FastifyInstance } from 'fastify';
import { leadsStore } from '../services.js';

export async function leadsRoute(app: FastifyInstance) {
  app.post('/leads', async (req, reply) => {
    if (!leadsStore.enabled) {
      return reply
        .status(503)
        .send({ error: 'persistence_unavailable', message: 'DATABASE_URL not set' });
    }

    const parsed = LeadCaptureRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ ok: false, error: 'Invalid payload.' });
    }

    await leadsStore.captureLead(parsed.data);
    return reply.status(201).send({ ok: true });
  });
}
