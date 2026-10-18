import { mergeHeatmapColumns } from '@oggregator/core';
import {
  VOL_HEATMAP_BUCKET,
  VOL_HEATMAP_RESOLUTIONS_SEC,
  type VolHeatmapResponse,
  VolHeatmapQuerySchema,
} from '@oggregator/protocol';
import type { FastifyInstance } from 'fastify';
import { volHeatmapRuntime } from '../services.js';

const HOUR_MS = 3_600_000;
const MAX_AUTO_COLUMNS = 480;

/** Finest resolution that keeps the buffered span at or under {@link MAX_AUTO_COLUMNS} columns. */
export function autoResolutionSec(spanMs: number): number {
  for (const sec of VOL_HEATMAP_RESOLUTIONS_SEC) {
    if (spanMs / (sec * 1000) <= MAX_AUTO_COLUMNS) return sec;
  }
  return VOL_HEATMAP_RESOLUTIONS_SEC[VOL_HEATMAP_RESOLUTIONS_SEC.length - 1]!;
}

export async function volHeatmapRoute(app: FastifyInstance) {
  app.get('/vol-heatmap', async (req, reply) => {
    if (volHeatmapRuntime == null) {
      return reply.status(503).send({ error: 'vol heatmap disabled' });
    }
    const parsed = VolHeatmapQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid vol-heatmap query', details: parsed.error.flatten() });
    }
    const { currency, hours, since } = parsed.data;
    const asOf = Date.now();
    const windowColumns = volHeatmapRuntime.getColumns(currency, asOf - hours * HOUR_MS);
    const resolutionSec =
      parsed.data.resolutionSec ?? autoResolutionSec(asOf - (windowColumns[0]?.t ?? asOf));
    const resolutionMs = resolutionSec * 1000;
    // Re-send the slot `since` falls in: it was still filling when the client last polled.
    const from = since != null ? Math.floor(since / resolutionMs) * resolutionMs : 0;

    return {
      currency,
      asOf,
      bucketSize: VOL_HEATMAP_BUCKET,
      resolutionSec,
      meta: volHeatmapRuntime.getMeta(currency),
      columns: mergeHeatmapColumns(
        from > 0 ? windowColumns.filter((c) => c.t >= from) : windowColumns,
        resolutionMs,
      ),
    } satisfies VolHeatmapResponse;
  });
}
