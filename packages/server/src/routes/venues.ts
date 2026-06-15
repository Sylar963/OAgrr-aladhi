import type { FastifyInstance } from 'fastify';
import { getAllAdapters, type OptionVenueAdapter } from '@oggregator/core';

export async function venuesRoute(app: FastifyInstance) {
  app.get('/venues', async () => {
    const adapters = getAllAdapters();
    return adapters.map((a: OptionVenueAdapter) => ({
      venue: a.venue,
      capabilities: a.capabilities,
    }));
  });
}
