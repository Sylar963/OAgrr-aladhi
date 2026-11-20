import { normalizeTradeUnderlying } from '@oggregator/core';
import type { CallPutBucket } from '@oggregator/db';
import {
  CALL_PUT_FLOW_MAX_DAYS,
  CALL_PUT_FLOW_RESOLUTIONS,
  type CallPutFlowBucket,
  type CallPutFlowResponse,
} from '@oggregator/protocol';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { tradeStore } from '../services.js';

const CACHE_TTL_MS = 60_000;
const CACHE_MAX_ENTRIES = 32;
const RETRY_DELAY_MS = 30_000;

const QuerySchema = z.object({
  underlying: z.string().min(1).default('BTC'),
  resolution: z.coerce
    .number()
    .refine(
      (v) => (CALL_PUT_FLOW_RESOLUTIONS as readonly number[]).includes(v),
      'unsupported resolution',
    )
    .default(3600),
  days: z.coerce.number().int().min(1).max(CALL_PUT_FLOW_MAX_DAYS).default(30),
});

export function toCallPutFlowBuckets(rows: readonly CallPutBucket[]): CallPutFlowBucket[] {
  const byTs = new Map<number, CallPutFlowBucket>();
  for (const row of rows) {
    const ts = Math.floor(row.bucketTs.getTime() / 1000);
    const bucket = byTs.get(ts) ?? {
      ts,
      callCount: 0,
      putCount: 0,
      callContracts: 0,
      putContracts: 0,
      callNotionalUsd: 0,
      putNotionalUsd: 0,
      callPremiumUsd: 0,
      putPremiumUsd: 0,
    };
    if (row.optionType === 'call') {
      bucket.callCount += row.count;
      bucket.callContracts += row.contracts;
      bucket.callNotionalUsd += row.notionalUsd;
      bucket.callPremiumUsd += row.premiumUsd;
    } else {
      bucket.putCount += row.count;
      bucket.putContracts += row.contracts;
      bucket.putNotionalUsd += row.notionalUsd;
      bucket.putPremiumUsd += row.premiumUsd;
    }
    byTs.set(ts, bucket);
  }
  return [...byTs.values()].sort((a, b) => a.ts - b.ts);
}

interface CachedWindow {
  buckets: CallPutFlowBucket[];
  endSec: number;
  updatedAt: number;
}

interface CacheEntry {
  refreshAt: number;
  snapshot?: CachedWindow;
  pending?: Promise<CachedWindow>;
}

const cache = new Map<string, CacheEntry>();

// Every lookback reads the full window so the store's per-flush remote cache is shared by all.
async function cachedFullWindow(
  key: string,
  endSec: number,
  load: () => Promise<CallPutFlowBucket[]>,
  onError: (error: unknown) => void,
): Promise<CachedWindow & { stale: boolean }> {
  const now = Date.now();
  let entry = cache.get(key);
  if (!entry) {
    entry = { refreshAt: 0 };
    cache.set(key, entry);
    for (const [k, candidate] of cache) {
      if (cache.size <= CACHE_MAX_ENTRIES) break;
      if (k !== key && !candidate.pending) cache.delete(k);
    }
  }
  const current = entry;
  const fresh =
    current.snapshot != null &&
    current.snapshot.updatedAt + CACHE_TTL_MS > now &&
    current.snapshot.endSec === endSec;
  if (!fresh && !current.pending && current.refreshAt <= now) {
    current.pending = load()
      .then((buckets) => {
        const snapshot = { buckets, endSec, updatedAt: Date.now() };
        current.snapshot = snapshot;
        current.refreshAt = Date.now() + CACHE_TTL_MS;
        return snapshot;
      })
      .catch((error: unknown) => {
        current.refreshAt = Date.now() + RETRY_DELAY_MS;
        onError(error);
        throw error;
      })
      .finally(() => {
        delete current.pending;
      });
    void current.pending.catch(() => {});
  }
  if (current.snapshot) return { ...current.snapshot, stale: !fresh };
  if (!current.pending) throw new Error('Flow history temporarily unavailable');
  return { ...(await current.pending), stale: false };
}

export function clearCallPutFlowCache(): void {
  cache.clear();
}

export async function callPutFlowRoute(app: FastifyInstance) {
  app.get('/flow/call-put-buckets', async (req, reply) => {
    const parsed = QuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid_query', issues: parsed.error.issues });
    }

    const underlying = normalizeTradeUnderlying(parsed.data.underlying);
    const { resolution, days } = parsed.data;
    const endSec = Math.ceil(Date.now() / 1000 / resolution) * resolution;
    const startSec = endSec - days * 86_400;

    if (!tradeStore.enabled) {
      return {
        available: false,
        underlying,
        resolution,
        start: startSec,
        end: endSec,
        buckets: [],
      } satisfies CallPutFlowResponse;
    }

    const fullStartSec = endSec - CALL_PUT_FLOW_MAX_DAYS * 86_400;
    const snapshot = await cachedFullWindow(
      `${underlying}|${resolution}`,
      endSec,
      async () =>
        toCallPutFlowBuckets(
          await tradeStore.bucketCallPut({
            mode: 'live',
            underlying,
            startTs: new Date(fullStartSec * 1000),
            endTs: new Date(endSec * 1000),
            resolutionSec: resolution,
          }),
        ),
      (err) => req.log.warn({ err, underlying, resolution }, 'flow history refresh failed'),
    );
    return {
      available: true,
      underlying,
      resolution,
      start: snapshot.endSec - days * 86_400,
      end: snapshot.endSec,
      buckets: snapshot.buckets.filter((bucket) => bucket.ts >= snapshot.endSec - days * 86_400),
      stale: snapshot.stale,
      updatedAt: snapshot.updatedAt,
    } satisfies CallPutFlowResponse;
  });
}
