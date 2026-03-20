import type { FastifyInstance } from 'fastify';
import { getAllAdapters, type OptionVenueAdapter } from '@oggregator/core';

export async function expiriesRoute(app: FastifyInstance) {
  app.get<{ Querystring: { underlying: string } }>('/expiries', async (req, reply) => {
    const { underlying } = req.query;
    if (!underlying) {
      return reply.status(400).send({ error: 'underlying query param required' });
    }

    const adapters = getAllAdapters();
    const results = await Promise.all(
      adapters.map(async (a: OptionVenueAdapter) => ({
        venue: a.venue,
        expiries: await a.listExpiries(underlying),
      })),
    );

    const all = new Set<string>();
    for (const r of results) {
      for (const e of r.expiries) all.add(e);
    }

    return {
      underlying,
      expiries: Array.from(all).sort(),
      byVenue: results,
    };
  });
}
