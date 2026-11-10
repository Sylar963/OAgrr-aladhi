import { randomUUID } from 'node:crypto';
import { evaluateAlphaTrade } from '@oggregator/core';
import { AlphaEvaluationRequestSchema, AlphaEvaluationResponseSchema } from '@oggregator/protocol';
import type { FastifyInstance } from 'fastify';
import { loadAlphaEvaluationMarket } from '../alpha-evaluation-source.js';

export async function alphaEvaluationRoute(app: FastifyInstance) {
  app.post('/alpha/evaluate', { bodyLimit: 16_384 }, async (req, reply) => {
    const parsed = AlphaEvaluationRequestSchema.safeParse(req.body);
    if (!parsed.success)
      return reply
        .status(400)
        .send({ error: 'Invalid evaluation', details: parsed.error.flatten() });
    const market = await loadAlphaEvaluationMarket(parsed.data.candidate.underlying, req.log);
    const result = evaluateAlphaTrade(parsed.data, market, { nowMs: Date.now(), id: randomUUID() });
    const response = AlphaEvaluationResponseSchema.safeParse(result);
    if (!response.success) {
      req.log.warn(
        { issues: response.error.issues },
        'Alpha evaluation exceeded supported numerical range',
      );
      return reply
        .status(422)
        .send({ error: 'Evaluation is outside the supported numerical range' });
    }
    reply.header('Cache-Control', 'no-store');
    return response.data;
  });
}
