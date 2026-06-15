import {
  buildComparisonChain,
  buildEnrichedChain,
  getAdapter,
  getAllAdapters,
  VENUE_IDS,
  type VenueId,
  type VenueOptionChain,
} from '@oggregator/core';
import type { FastifyInstance } from 'fastify';
import { chainEngines } from '../chain-engines.js';
import { bookLookup } from '../dealer-book-lookup.js';
import { ResponseCache } from '../response-cache.js';

const CHAIN_RESPONSE_CACHE_TTL_MS = 5_000;
const chainResponseCache = new ResponseCache(CHAIN_RESPONSE_CACHE_TTL_MS);

function parseVenues(venuesParam: string | undefined): VenueId[] {
  return venuesParam
    ? (venuesParam.split(',').filter((venue) => VENUE_IDS.includes(venue as VenueId)) as VenueId[])
    : getAllAdapters().map((adapter) => adapter.venue);
}

export async function chainsRoute(app: FastifyInstance) {
  chainEngines.start();

  app.addHook('onClose', async () => {
    await chainEngines.dispose();
  });

  app.get<{
    Querystring: { underlying: string; expiry: string; venues?: string };
  }>('/chains', async (req, reply) => {
    const { underlying, expiry, venues: venuesParam } = req.query;

    if (!underlying || !expiry) {
      return reply.status(400).send({ error: 'underlying and expiry query params required' });
    }

    const requestedVenues = parseVenues(venuesParam);
    const cacheKey = `${underlying}:${expiry}:${requestedVenues.slice().sort().join(',')}`;
    return chainResponseCache.get(cacheKey, async () => {
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
      return buildEnrichedChain(underlying, expiry, comparison.rows, chains, bookLookup);
    });
  });
}
