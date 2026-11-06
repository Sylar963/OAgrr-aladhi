import type { StrikeFlowBucket, StrikeFlowBucketQuery } from '@oggregator/db';
import { normalizeTradeUnderlying } from '@oggregator/core';
import {
  FlowStrikeMapResponseSchema,
  VenueIdSchema,
  type FlowStrikeMapResponse,
} from '@oggregator/protocol';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { tradeStore } from '../services.js';

const RESOLUTIONS = [900, 3600, 14400, 86400] as const;
const MAX_RANGE_MS = 90 * 86_400_000;
const CACHE_TTL_MS = 30_000;
const CACHE_MAX_ENTRIES = 32;
const IV_POINT_LIMIT = 2_500;

const QuerySchema = z.object({
  underlying: z.string().min(1),
  venue: z.string().refine((value) => VenueIdSchema.safeParse(value).success),
  expiry: z.string().min(1),
  start: z.string().refine((value) => Number.isFinite(Date.parse(value)), 'invalid start'),
  end: z.string().refine((value) => Number.isFinite(Date.parse(value)), 'invalid end'),
  resolution: z.coerce.number().refine((value) => RESOLUTIONS.includes(value as (typeof RESOLUTIONS)[number])),
});

const cache = new Map<string, { expiresAt: number; value: Promise<FlowStrikeMapResponse> }>();

function toResponse(
  query: z.infer<typeof QuerySchema>,
  rows: readonly StrikeFlowBucket[],
  instruments: Awaited<ReturnType<typeof tradeStore.listInstruments>>,
): FlowStrikeMapResponse {
  const buckets = rows.map((row) => ({
    bucketTs: row.bucketTs.getTime(),
    instrument: row.instrument,
    expiry: row.expiry,
    strike: row.strike,
    optionType: row.optionType,
    side: row.side,
    count: row.count,
    contracts: row.contracts,
    premiumUsd: row.premiumUsd,
    notionalUsd: row.notionalUsd,
  }));
  const pointsByKey = new Map<string, {
    bucketTs: number;
    optionType: 'call' | 'put';
    side: 'buy' | 'sell';
    count: number;
    contracts: number;
    notionalUsd: number;
  }>();
  for (const bucket of buckets) {
    const key = `${bucket.bucketTs}|${bucket.optionType}|${bucket.side}`;
    const point = pointsByKey.get(key) ?? {
      bucketTs: bucket.bucketTs,
      optionType: bucket.optionType,
      side: bucket.side,
      count: 0,
      contracts: 0,
      notionalUsd: 0,
    };
    point.count += bucket.count;
    point.contracts += bucket.contracts;
    point.notionalUsd += bucket.notionalUsd;
    pointsByKey.set(key, point);
  }
  const totals = buckets.reduce(
    (sum, bucket) => {
      sum.count += bucket.count;
      sum.premiumUsd += bucket.premiumUsd;
      sum.notionalUsd += bucket.notionalUsd;
      if (bucket.side === 'buy') sum.buyNotionalUsd += bucket.notionalUsd;
      else sum.sellNotionalUsd += bucket.notionalUsd;
      return sum;
    },
    { count: 0, premiumUsd: 0, notionalUsd: 0, buyNotionalUsd: 0, sellNotionalUsd: 0 },
  );
  return FlowStrikeMapResponseSchema.parse({
    available: true,
    underlying: normalizeTradeUnderlying(query.underlying),
    venue: query.venue,
    expiry: query.expiry,
    start: Date.parse(query.start),
    end: Date.parse(query.end),
    resolution: query.resolution,
    ...totals,
    points: [...pointsByKey.values()].sort(
      (left, right) => left.bucketTs - right.bucketTs || left.optionType.localeCompare(right.optionType) || left.side.localeCompare(right.side),
    ),
    buckets,
    ivPoints: instruments.flatMap((instrument) =>
      instrument.optionType == null || instrument.strike == null
        ? []
        : [{
            instrument: instrument.instrument,
            strike: instrument.strike,
            optionType: instrument.optionType,
            iv: instrument.lastIv,
            observedAt: instrument.lastIvAt?.getTime() ?? null,
            count: instrument.count,
          }],
    ),
    ivCoverageComplete: instruments.length < IV_POINT_LIMIT,
  });
}

async function cachedMap(
  key: string,
  load: () => Promise<FlowStrikeMapResponse>,
): Promise<FlowStrikeMapResponse> {
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) return cached.value;
  for (const [entryKey, entry] of cache) {
    if (entry.expiresAt <= now || cache.size >= CACHE_MAX_ENTRIES) cache.delete(entryKey);
  }
  const value = load();
  cache.set(key, { expiresAt: now + CACHE_TTL_MS, value });
  value.catch(() => cache.delete(key));
  return value;
}

export function clearFlowStrikeMapCache(): void {
  cache.clear();
}

export async function flowStrikeMapRoute(app: FastifyInstance) {
  app.get('/flow/strike-map', async (req, reply) => {
    const parsed = QuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid_query', issues: parsed.error.issues });
    }

    const query = parsed.data;
    const underlying = normalizeTradeUnderlying(query.underlying);
    const startTs = new Date(query.start);
    const endTs = new Date(query.end);
    if (startTs >= endTs || endTs.getTime() - startTs.getTime() > MAX_RANGE_MS) {
      return reply.status(400).send({ error: 'invalid_range', maxDays: 90 });
    }

    const responseQuery = { ...query, underlying };
    if (!tradeStore.enabled) {
      return FlowStrikeMapResponseSchema.parse({
        available: false,
        underlying,
        venue: query.venue,
        expiry: query.expiry,
        start: startTs.getTime(),
        end: endTs.getTime(),
        resolution: query.resolution,
        count: 0,
        premiumUsd: 0,
        notionalUsd: 0,
        buyNotionalUsd: 0,
        sellNotionalUsd: 0,
        points: [],
        buckets: [],
        ivPoints: [],
        ivCoverageComplete: true,
      });
    }

    const storeQuery: StrikeFlowBucketQuery = {
      mode: 'live',
      underlying,
      venues: [query.venue],
      expiry: query.expiry,
      startTs,
      endTs,
      resolutionSec: query.resolution,
    };
    const key = [
      underlying,
      query.venue,
      query.expiry,
      startTs.getTime(),
      endTs.getTime(),
      query.resolution,
    ].join('|');
    return cachedMap(key, async () => {
      const [buckets, instruments] = await Promise.all([
        tradeStore.bucketStrikeFlow(storeQuery),
        tradeStore.listInstruments({
          mode: 'live',
          underlying,
          venues: [query.venue],
          expiry: query.expiry,
          startTs,
          endTs,
          limit: IV_POINT_LIMIT,
        }),
      ]);
      return toResponse(responseQuery, buckets, instruments);
    });
  });
}
