import type { FastifyInstance } from 'fastify';
import type { OptionVenueAdapter } from '@oggregator/core';
import { getAdaptersByAssetClass } from '../../asset-class.js';

export async function v2UnderlyingsRoute(app: FastifyInstance) {
  app.get('/v2/underlyings', async () => {
    const adapters = getAdaptersByAssetClass('tradfi');
    const results = await Promise.all(
      adapters.map(async (a: OptionVenueAdapter) => ({
        venue: a.venue,
        underlyings: await a.listUnderlyings(),
      })),
    );

    const all = new Set<string>();
    for (const r of results) {
      for (const u of r.underlyings) all.add(u);
    }

    return {
      underlyings: Array.from(all).sort(),
      byVenue: results,
    };
  });
}
