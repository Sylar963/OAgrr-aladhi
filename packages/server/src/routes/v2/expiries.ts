import type { FastifyInstance } from 'fastify';
import type { OptionVenueAdapter } from '@oggregator/core';
import { getAdaptersByAssetClass } from '../../asset-class.js';

export async function v2ExpiriesRoute(app: FastifyInstance) {
  app.get<{ Querystring: { underlying: string } }>('/v2/expiries', async (req, reply) => {
    const { underlying } = req.query;
    if (!underlying) {
      return reply.status(400).send({ error: 'underlying query param required' });
    }

    const adapters = getAdaptersByAssetClass('tradfi');
    const results = await Promise.all(
      adapters.map(async (a: OptionVenueAdapter) => ({
        venue: a.venue,
        expiries: await a.listExpiries(underlying),
        timestamps: (await a.listExpiryTimestamps?.(underlying)) ?? [],
      })),
    );

    const all = new Set<string>();
    const minTsByExpiry = new Map<string, number>();
    for (const r of results) {
      for (const e of r.expiries) all.add(e);
      for (const { expiry, expiryTs } of r.timestamps) {
        if (expiryTs == null) continue;
        const prev = minTsByExpiry.get(expiry);
        if (prev === undefined || expiryTs < prev) minTsByExpiry.set(expiry, expiryTs);
      }
    }

    const expiries = Array.from(all).sort();
    const timestamps = expiries.map((expiry) => ({
      expiry,
      expiryTs: minTsByExpiry.get(expiry) ?? null,
    }));

    return {
      underlying,
      expiries,
      timestamps,
      byVenue: results,
    };
  });
}
