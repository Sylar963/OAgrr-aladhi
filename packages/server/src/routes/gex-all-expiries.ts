import type { FastifyInstance } from 'fastify';
import {
  buildComparisonChain,
  buildEnrichedChain,
  combineGex,
  getAdapter,
  getAllAdapters,
  VENUE_IDS,
  type GexStrike,
  type VenueId,
  type VenueOptionChain,
} from '@oggregator/core';

function parseVenues(venuesParam: string | undefined): VenueId[] {
  return venuesParam
    ? (venuesParam.split(',').filter((venue) => VENUE_IDS.includes(venue as VenueId)) as VenueId[])
    : getAllAdapters().map((adapter) => adapter.venue);
}

async function collectUnderlyingExpiries(underlying: string): Promise<string[]> {
  const adapters = getAllAdapters();
  const lists = await Promise.all(adapters.map((a) => a.listExpiries(underlying)));
  const all = new Set<string>();
  for (const list of lists) {
    for (const expiry of list) all.add(expiry);
  }
  return Array.from(all).sort();
}

export interface AllExpiriesGexResponse {
  underlying: string;
  expiries: string[];
  spotPrice: number | null;
  gex: GexStrike[];
}

export async function gexAllExpiriesRoute(app: FastifyInstance) {
  app.get<{ Querystring: { underlying: string; venues?: string } }>(
    '/gex-all-expiries',
    async (req, reply): Promise<AllExpiriesGexResponse | { error: string }> => {
      const { underlying, venues: venuesParam } = req.query;
      if (!underlying) {
        return reply.status(400).send({ error: 'underlying query param required' });
      }

      const requestedVenues = parseVenues(venuesParam);
      const expiries = await collectUnderlyingExpiries(underlying);
      if (expiries.length === 0) {
        return { underlying, expiries: [], spotPrice: null, gex: [] };
      }

      const snapshots = await Promise.all(
        expiries.map(async (expiry) => {
          const chains = (
            await Promise.all(
              requestedVenues.map(async (venue): Promise<VenueOptionChain | null> => {
                try {
                  return await getAdapter(venue).fetchOptionChain({ underlying, expiry });
                } catch {
                  return null;
                }
              }),
            )
          ).filter((chain): chain is VenueOptionChain => chain != null);
          const comparison = buildComparisonChain(underlying, expiry, chains);
          return buildEnrichedChain(underlying, expiry, comparison.rows, chains);
        }),
      );

      const aggregated = combineGex(snapshots.map((snap) => snap.gex));
      const first = snapshots[0];
      const spotPrice =
        first != null ? (first.stats.indexPriceUsd ?? first.stats.forwardPriceUsd) : null;

      return { underlying, expiries, spotPrice, gex: aggregated };
    },
  );
}
