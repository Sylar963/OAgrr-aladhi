import type { FastifyInstance } from 'fastify';
import {
  getAllAdapters,
  getAdapter,
  buildComparisonChain,
  buildEnrichedChain,
  type ChainRequest,
  type VenueId,
  type VenueStatus,
  VENUE_IDS,
} from '@oggregator/core';

const activeSubscriptions = new Map<string, () => Promise<void>>();

function subKey(venue: VenueId, underlying: string, expiry: string) {
  return `${venue}:${underlying}:${expiry}`;
}

async function ensureSubscribed(venueId: VenueId, underlying: string, expiry: string, log: FastifyInstance['log']) {
  const key = subKey(venueId, underlying, expiry);
  if (activeSubscriptions.has(key)) return;

  const adapter = getAdapter(venueId);
  if (!adapter.subscribe) return;

  try {
    const unsub = await adapter.subscribe(
      { underlying, expiry },
      {
        onDelta: () => {},
        onStatus: (status: VenueStatus) => {
          if (status.state === 'degraded' || status.state === 'down') {
            log.warn({ venue: venueId, state: status.state }, status.message ?? 'venue degraded');
          }
        },
      },
    );
    activeSubscriptions.set(key, unsub);
    log.info({ venue: venueId, underlying }, 'ws subscription active');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn({ venue: venueId, underlying, err: message }, 'ws subscription failed');
  }
}

async function fetchChains(underlying: string, expiry: string, requestedVenues: VenueId[], log: FastifyInstance['log']) {
  for (const venueId of requestedVenues) {
    ensureSubscribed(venueId, underlying, expiry, log).catch(() => {});
  }

  const request: ChainRequest = { underlying, expiry, venues: requestedVenues };

  const venueChains = await Promise.allSettled(
    requestedVenues.map(async (venueId) => {
      const adapter = getAdapter(venueId);
      return adapter.fetchOptionChain(request);
    }),
  );

  const successfulChains = venueChains
    .filter((r) => r.status === 'fulfilled')
    .map((r) => (r as PromiseFulfilledResult<Awaited<ReturnType<ReturnType<typeof getAdapter>['fetchOptionChain']>>>).value);

  return { request, successfulChains };
}

function parseVenues(venuesParam: string | undefined): VenueId[] {
  return venuesParam
    ? (venuesParam.split(',').filter((v) => VENUE_IDS.includes(v as VenueId)) as VenueId[])
    : getAllAdapters().map((a) => a.venue);
}

export async function chainsRoute(app: FastifyInstance) {
  app.get<{
    Querystring: { underlying: string; expiry: string; venues?: string };
  }>('/chains', async (req, reply) => {
    const { underlying, expiry, venues: venuesParam } = req.query;

    if (!underlying || !expiry) {
      return reply.status(400).send({ error: 'underlying and expiry query params required' });
    }

    const requestedVenues = parseVenues(venuesParam);
    const { successfulChains } = await fetchChains(underlying, expiry, requestedVenues, req.log);
    const comparison = buildComparisonChain(underlying, expiry, successfulChains);

    return buildEnrichedChain(underlying, expiry, comparison.rows, successfulChains);
  });
}
