import type { FastifyInstance } from 'fastify';
import { getAllAdapters, type OptionVenueAdapter } from '@oggregator/core';

function toPublicUnderlying(underlying: string, venueUnderlyings: readonly string[]): string {
  const [base, settle] = underlying.split('_');
  if (!base || !settle) return underlying;
  return venueUnderlyings.includes(base) ? underlying : base;
}

export async function underlyingsRoute(app: FastifyInstance) {
  app.get('/underlyings', async () => {
    const adapters = getAllAdapters();
    const results = await Promise.all(
      adapters.map(async (adapter: OptionVenueAdapter) => {
        const canonical = await adapter.listUnderlyings();
        return {
          venue: adapter.venue,
          underlyings: [...new Set(canonical.map((underlying) => toPublicUnderlying(underlying, canonical)))].sort(),
        };
      }),
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
