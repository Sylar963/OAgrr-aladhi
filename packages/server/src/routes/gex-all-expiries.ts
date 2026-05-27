import type { FastifyInstance } from 'fastify';
import {
  combineGex,
  getAllAdapters,
  VENUE_IDS,
  type GexStrike,
  type VenueId,
} from '@oggregator/core';
import { chainEngines } from '../chain-engines.js';

const GEX_ALL_EXPIRIES_CONCURRENCY = 5;

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

async function mapConcurrent<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex]!, currentIndex);
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

export interface AllExpiriesGexResponse {
  underlying: string;
  expiries: string[];
  spotPrice: number | null;
  gex: GexStrike[];
}

export async function gexAllExpiriesRoute(app: FastifyInstance) {
  chainEngines.start();

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

      const snapshots = await mapConcurrent(
        expiries,
        GEX_ALL_EXPIRIES_CONCURRENCY,
        async (expiry) => {
          const handle = await chainEngines.acquire({ underlying, expiry, venues: requestedVenues });
          try {
            return await handle.runtime.fetchSnapshotData();
          } finally {
            await handle.release();
          }
        },
      );

      const perExpiryGex = snapshots.map((snap) => snap.gex);
      const aggregated = combineGex(perExpiryGex);

      const first = snapshots[0];
      const spotPrice =
        first != null ? (first.stats.indexPriceUsd ?? first.stats.forwardPriceUsd) : null;

      return { underlying, expiries, spotPrice, gex: aggregated };
    },
  );
}
