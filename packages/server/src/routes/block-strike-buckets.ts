import type { FastifyInstance } from 'fastify';
import {
  getVenueContractMultiplier,
  normalizeTradeUnderlying,
  parseTradeInstrument,
} from '@oggregator/core';
import type { PersistedTradeRecord, TradeHistoryQuery } from '@oggregator/db';
import { z } from 'zod';

import { tradeStore } from '../services.js';

const RESOLUTIONS = [60, 300, 900, 1800, 3600, 14400, 86400] as const;
const MAX_WINDOW_SEC = 400 * 86_400;
const PAGE_SIZE = 1000;
const MAX_ROWS = 100_000;
const CACHE_TTL_MS = 60_000;
const CACHE_MAX_ENTRIES = 32;

export interface BlockStrikeBucket {
  ts: number;
  strike: number;
  expiry: string | null;
  callContracts: number;
  putContracts: number;
  callNotionalUsd: number;
  putNotionalUsd: number;
  legs: number;
}

export interface BlockStrikeBucketsResponse {
  available: boolean;
  underlying: string;
  resolution: number;
  start: number;
  end: number;
  truncated: boolean;
  buckets: BlockStrikeBucket[];
}

const isoDate = z
  .string()
  .refine((v: string) => !Number.isNaN(new Date(v).getTime()), 'invalid date');

const QuerySchema = z
  .object({
    underlying: z.string().min(1).default('BTC'),
    resolution: z.coerce
      .number()
      .refine((v) => (RESOLUTIONS as readonly number[]).includes(v), 'unsupported resolution'),
    start: isoDate,
    end: isoDate.optional(),
  })
  .refine(
    (q) => {
      const startMs = new Date(q.start).getTime();
      const endMs = q.end ? new Date(q.end).getTime() : Date.now();
      return endMs > startMs && endMs - startMs <= MAX_WINDOW_SEC * 1000;
    },
    { message: `window must be positive and at most ${MAX_WINDOW_SEC / 86_400} days` },
  );

export function aggregateBlockStrikeBuckets(
  rows: readonly PersistedTradeRecord[],
  resolutionSec: number,
): BlockStrikeBucket[] {
  const buckets = new Map<string, BlockStrikeBucket>();

  for (const row of rows) {
    const ts = Math.floor(row.tradeTs.getTime() / 1000 / resolutionSec) * resolutionSec;
    const multiplier = getVenueContractMultiplier(row.venue, row.underlying);
    const referencePriceUsd =
      row.referencePriceUsd != null && row.referencePriceUsd > 0 ? row.referencePriceUsd : null;
    const legs =
      row.legs && row.legs.length > 0
        ? row.legs.map((leg) => ({
            instrument: leg.instrument,
            contracts: Math.abs(leg.size * leg.ratio) * multiplier,
          }))
        : [{ instrument: row.instrumentName, contracts: Math.abs(row.contracts) }];

    for (const leg of legs) {
      const parsed = parseTradeInstrument(leg.instrument);
      if (parsed.strike == null || parsed.optionType == null || !(leg.contracts > 0)) continue;

      const key = `${ts}|${parsed.strike}|${parsed.expiry ?? ''}`;
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = {
          ts,
          strike: parsed.strike,
          expiry: parsed.expiry,
          callContracts: 0,
          putContracts: 0,
          callNotionalUsd: 0,
          putNotionalUsd: 0,
          legs: 0,
        };
        buckets.set(key, bucket);
      }

      const notionalUsd = referencePriceUsd != null ? leg.contracts * referencePriceUsd : 0;
      if (parsed.optionType === 'call') {
        bucket.callContracts += leg.contracts;
        bucket.callNotionalUsd += notionalUsd;
      } else {
        bucket.putContracts += leg.contracts;
        bucket.putNotionalUsd += notionalUsd;
      }
      bucket.legs += 1;
    }
  }

  return [...buckets.values()].sort((a, b) => a.ts - b.ts || a.strike - b.strike);
}

async function loadInstitutionalRange(
  underlying: string,
  startTs: Date,
  endTs: Date,
): Promise<{ rows: PersistedTradeRecord[]; truncated: boolean }> {
  const rows: PersistedTradeRecord[] = [];
  let cursor: { beforeTs: Date; beforeUid: string } | null = null;

  while (rows.length < MAX_ROWS) {
    const query: TradeHistoryQuery = {
      mode: 'institutional',
      underlying,
      startTs,
      endTs,
      limit: PAGE_SIZE,
    };
    if (cursor) {
      query.beforeTs = cursor.beforeTs;
      query.beforeUid = cursor.beforeUid;
    }

    const page = await tradeStore.loadHistory(query);
    rows.push(...page);
    const last = page[page.length - 1];
    if (page.length < PAGE_SIZE || !last) return { rows, truncated: false };
    cursor = { beforeTs: last.tradeTs, beforeUid: last.tradeUid };
  }

  return { rows, truncated: true };
}

const cache = new Map<string, { expiresAt: number; value: Promise<BlockStrikeBucketsResponse> }>();

function cached(
  key: string,
  load: () => Promise<BlockStrikeBucketsResponse>,
): Promise<BlockStrikeBucketsResponse> {
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

export function clearBlockStrikeBucketsCache(): void {
  cache.clear();
}

export async function blockStrikeBucketsRoute(app: FastifyInstance) {
  app.get('/block-flow/strike-buckets', async (req, reply) => {
    const parsed = QuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid_query', issues: parsed.error.issues });
    }

    const underlying = normalizeTradeUnderlying(parsed.data.underlying);
    const { resolution } = parsed.data;
    const startSec = Math.floor(new Date(parsed.data.start).getTime() / 1000 / resolution) * resolution;
    const endMs = parsed.data.end ? new Date(parsed.data.end).getTime() : Date.now();
    const endSec = Math.ceil(endMs / 1000 / resolution) * resolution;

    if (!tradeStore.enabled) {
      return {
        available: false,
        underlying,
        resolution,
        start: startSec,
        end: endSec,
        truncated: false,
        buckets: [],
      } satisfies BlockStrikeBucketsResponse;
    }

    return cached(`${underlying}|${resolution}|${startSec}|${endSec}`, async () => {
      const { rows, truncated } = await loadInstitutionalRange(
        underlying,
        new Date(startSec * 1000),
        new Date(endSec * 1000),
      );
      return {
        available: true,
        underlying,
        resolution,
        start: startSec,
        end: endSec,
        truncated,
        buckets: aggregateBlockStrikeBuckets(rows, resolution),
      };
    });
  });
}
