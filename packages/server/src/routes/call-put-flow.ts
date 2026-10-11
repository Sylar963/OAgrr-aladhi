import type { FastifyInstance } from 'fastify';
import { normalizeTradeUnderlying } from '@oggregator/core';
import type { CallPutBucket } from '@oggregator/db';
import {
  CALL_PUT_FLOW_MAX_DAYS,
  CALL_PUT_FLOW_RESOLUTIONS,
  type CallPutFlowBucket,
  type CallPutFlowResponse,
} from '@oggregator/protocol';
import { z } from 'zod';

import { tradeStore } from '../services.js';

const CACHE_TTL_MS = 60_000;
const CACHE_MAX_ENTRIES = 32;

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

const cache = new Map<string, { expiresAt: number; value: Promise<CallPutFlowBucket[]> }>();

// Every lookback reads the full window so the store's per-flush remote cache is shared by all.
function cachedFullWindow(
  key: string,
  load: () => Promise<CallPutFlowBucket[]>,
): Promise<CallPutFlowBucket[]> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) return hit.value;

  for (const [k, entry] of cache) {
    if (entry.expiresAt <= now || cache.size >= CACHE_MAX_ENTRIES) cache.delete(k);
  }

  const value = load();
  cache.set(key, { expiresAt: now + CACHE_TTL_MS, value });
  value.catch(() => cache.delete(key));
  return value;
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
    const buckets = await cachedFullWindow(`${underlying}|${resolution}|${endSec}`, async () =>
      toCallPutFlowBuckets(
        await tradeStore.bucketCallPut({
          mode: 'live',
          underlying,
          startTs: new Date(fullStartSec * 1000),
          endTs: new Date(endSec * 1000),
          resolutionSec: resolution,
        }),
      ),
    );
    return {
      available: true,
      underlying,
      resolution,
      start: startSec,
      end: endSec,
      buckets: buckets.filter((bucket) => bucket.ts >= startSec),
    } satisfies CallPutFlowResponse;
  });
}
