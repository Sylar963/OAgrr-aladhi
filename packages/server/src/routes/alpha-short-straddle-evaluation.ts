import {
  ShortStraddleEvaluationQuerySchema,
  ShortStraddleEvaluationResponseSchema,
} from '@oggregator/protocol';
import type { FastifyInstance } from 'fastify';

import { evaluateShortStraddleSnapshots } from '../short-straddle-evaluator.js';
import { shortStraddleSnapshotStore } from '../services.js';

const DAY_MS = 86_400_000;

export async function alphaShortStraddleEvaluationRoute(app: FastifyInstance) {
  app.get<{
    Querystring: { underlying?: string; windowDays?: string; minimumSamples?: string };
  }>(
    '/alpha/short-straddle-evaluation',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const parsed = ShortStraddleEvaluationQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return reply.status(400).send({
          error: 'invalid short-straddle evaluation query',
          details: parsed.error.flatten(),
        });
      }
      if (shortStraddleSnapshotStore == null) {
        return reply.status(503).send({ error: 'short-straddle evidence collection unavailable' });
      }
      const observations = await shortStraddleSnapshotStore.loadSince({
        underlying: parsed.data.underlying,
        since: new Date(Date.now() - parsed.data.windowDays * DAY_MS),
      });
      return ShortStraddleEvaluationResponseSchema.parse(
        evaluateShortStraddleSnapshots(observations, { ...parsed.data, asOfMs: Date.now() }),
      );
    },
  );
}
