import type { FastifyInstance } from 'fastify';
import { getAllAdapters, type OptionVenueAdapter } from '@oggregator/core';

export async function underlyingsRoute(app: FastifyInstance) {
  app.get('/underlyings', async () => {
    const adapters = getAllAdapters();
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
