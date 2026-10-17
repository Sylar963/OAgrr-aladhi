import type { FastifyInstance } from 'fastify';

import { listPublicUnderlyingsByVenue } from '../public-underlyings.js';

export async function underlyingsRoute(app: FastifyInstance) {
  app.get('/underlyings', async () => {
    const results = await listPublicUnderlyingsByVenue();

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
