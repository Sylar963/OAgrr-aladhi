import {
  type EquityHistoryBasis,
  type EquityHistoryPoint,
  type EquityHistoryRange,
  EquityHistoryRangeSchema,
  type EquityHistoryResponse,
  type EquityHistoryVenue,
  EquityHistoryVenueSchema,
} from '@oggregator/protocol';
import { DEFAULT_ACCOUNT_ID } from '@oggregator/trading';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { derivePositionStore } from '../../derive-position-store.js';
import { toDailyCloses } from '../../equity-daily-closes.js';
import { paradexPositionStore } from '../../paradex-position-store.js';
import { thalexPositionStore } from '../../thalex-position-store.js';
import { getRequestAccountId } from '../../user-service.js';

export { toDailyCloses };

const EquityHistoryQuerySchema = z.object({
  venue: z.string(),
  range: z.string().optional(),
});

const DAY_MS = 86_400_000;
const RANGE_DAYS: Record<EquityHistoryRange, number> = { '1M': 30, '3M': 90 };
const MAX_RANGE_DAYS = RANGE_DAYS['3M'];
const CACHE_TTL_MS = 5 * 60_000;

const VENUE_BASIS: Record<EquityHistoryVenue, EquityHistoryBasis> = {
  derive: 'venue_value',
  paradex: 'venue_value',
  thalex: 'cash_replay',
};

interface CachedHistory {
  fetchedAt: number;
  points: EquityHistoryPoint[];
}

const cache = new Map<string, CachedHistory>();
const inFlight = new Map<string, Promise<CachedHistory | null>>();

export function sliceRange(
  points: readonly EquityHistoryPoint[],
  range: EquityHistoryRange,
  nowMs: number,
): EquityHistoryPoint[] {
  const fromMs = nowMs - RANGE_DAYS[range] * DAY_MS;
  return points.filter((point) => point.ts >= fromMs);
}

function fetchVenueHistory(
  venue: EquityHistoryVenue,
  accountId: string,
  fromMs: number,
): Promise<EquityHistoryPoint[] | null> {
  if (venue === 'derive') return derivePositionStore.fetchEquityHistory(accountId, fromMs);
  if (venue === 'thalex') return thalexPositionStore.fetchEquityHistory(accountId, fromMs);
  return paradexPositionStore.fetchEquityHistory(accountId, fromMs);
}

// Always fetches the widest range so switching 1M ↔ 3M is served from one venue call.
async function loadHistory(
  venue: EquityHistoryVenue,
  accountId: string,
  nowMs: number,
): Promise<CachedHistory | null> {
  const key = `${accountId}|${venue}`;
  const cached = cache.get(key);
  if (cached != null && nowMs - cached.fetchedAt < CACHE_TTL_MS) return cached;
  const pending = inFlight.get(key);
  if (pending != null) return pending;

  const request = fetchVenueHistory(venue, accountId, nowMs - MAX_RANGE_DAYS * DAY_MS)
    .then((points) => {
      if (points == null) {
        cache.delete(key);
        return null;
      }
      const entry = { fetchedAt: nowMs, points: toDailyCloses(points) };
      cache.set(key, entry);
      return entry;
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, request);
  return request;
}

export async function portfolioEquityHistoryRoute(app: FastifyInstance) {
  app.get('/portfolio/equity-history', async (req, reply) => {
    const parsed = EquityHistoryQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid_query', issues: parsed.error.issues });
    }
    const venueParsed = EquityHistoryVenueSchema.safeParse(parsed.data.venue);
    if (!venueParsed.success) return reply.status(400).send({ error: 'invalid_venue' });
    const rangeParsed = EquityHistoryRangeSchema.safeParse(parsed.data.range ?? '1M');
    if (!rangeParsed.success) return reply.status(400).send({ error: 'invalid_range' });
    const venue = venueParsed.data;
    const range = rangeParsed.data;
    const accountId = getRequestAccountId(req, DEFAULT_ACCOUNT_ID);
    const nowMs = Date.now();

    let history: CachedHistory | null;
    try {
      history = await loadHistory(venue, accountId, nowMs);
    } catch (err) {
      req.log.warn({ err: String(err), venue }, 'portfolio equity history fetch failed');
      return reply.status(502).send({
        error: 'venue_history_unavailable',
        message: `Could not load equity history from ${venue}.`,
      });
    }
    if (history == null) {
      return reply.status(409).send({
        error: 'venue_not_connected',
        message: `Sign in to ${venue} to see account equity history.`,
      });
    }

    const response: EquityHistoryResponse = {
      accountId,
      venue,
      range,
      basis: VENUE_BASIS[venue],
      fetchedAt: history.fetchedAt,
      points: sliceRange(history.points, range, nowMs),
    };
    return response;
  });
}
