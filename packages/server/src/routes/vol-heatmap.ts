import { mergeHeatmapColumns } from '@oggregator/core';
import {
  VOL_HEATMAP_BUCKET,
  type VolHeatmapResponse,
  VolHeatmapQuerySchema,
} from '@oggregator/protocol';
import type { FastifyInstance } from 'fastify';
import { volHeatmapRuntime } from '../services.js';

const HOUR_MS = 3_600_000;

export async function volHeatmapRoute(app: FastifyInstance) {
  app.get('/vol-heatmap', async (req, reply) => {
    if (volHeatmapRuntime == null) {
      return reply.status(503).send({ error: 'vol heatmap disabled' });
    }
    const parsed = VolHeatmapQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid vol-heatmap query', details: parsed.error.flatten() });
    }
    const { currency, hours, resolutionSec, since } = parsed.data;
    const resolutionMs = resolutionSec * 1000;
    const asOf = Date.now();
    const windowStart = asOf - hours * HOUR_MS;
    // Re-send the slot `since` falls in: it was still filling when the client last polled.
    const from = Math.floor(Math.max(windowStart, since ?? 0) / resolutionMs) * resolutionMs;

    return {
      currency,
      asOf,
      bucketSize: VOL_HEATMAP_BUCKET,
      resolutionSec,
      meta: volHeatmapRuntime.getMeta(currency),
      columns: mergeHeatmapColumns(volHeatmapRuntime.getColumns(currency, from), resolutionMs),
    } satisfies VolHeatmapResponse;
  });
}
