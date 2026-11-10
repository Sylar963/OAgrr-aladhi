import {
  buildComparisonChain,
  buildCryptoMoveSessions,
  buildEnrichedChain,
  evaluateExpectedStraddle,
  getAdapter,
} from '@oggregator/core';
import {
  ExpectedMoveQuerySchema,
  ExpectedMoveResponseSchema,
  ExpectedStraddleQuerySchema,
  ExpectedStraddleResponseSchema,
  type ExpectedStraddleResponse,
  type VenueId,
} from '@oggregator/protocol';
import type { FastifyInstance } from 'fastify';
import { ResponseCache } from '../response-cache.js';
import { aggregatedSpotRuntime, dvolService, isDvolReady } from '../services.js';

export async function expectedMoveRoute(app: FastifyInstance) {
  const straddles = new ResponseCache<ExpectedStraddleResponse>(5_000);
  app.get('/expected-move', async (req, reply) => {
    const parsed = ExpectedMoveQuerySchema.safeParse(req.query);
    if (!parsed.success || parsed.data.underlying === 'SPX') {
      return reply.code(400).send({ error: 'Invalid crypto expected-move query' });
    }
    if (!isDvolReady()) return reply.code(503).send({ error: 'DVOL service not available' });
    const { underlying, anchor, days } = parsed.data;
    try {
      const [hourly, tail] = await Promise.all([
        aggregatedSpotRuntime.getCandles(underlying, 3600, (days + 2) * 24),
        aggregatedSpotRuntime.getCandles(underlying, 60, 3),
      ]);
      const nowMs = Date.now();
      const latest = tail.candles.at(-1);
      const sessions = buildCryptoMoveSessions({
        candles: hourly.candles,
        ivCandles: dvolService.getHistory(underlying).map((c) => ({
          ...c,
          open: c.open / 100,
          high: c.high / 100,
          low: c.low / 100,
          close: c.close / 100,
        })),
        anchorHour: anchor === 'utc8' ? 8 : 0,
        days,
        nowMs,
        latest: latest == null ? null : { price: latest.close, asOfMs: latest.timestamp },
      });
      const snapshot = dvolService.getSnapshot(underlying);
      const live =
        snapshot != null && nowMs - snapshot.updatedAt <= 120_000 && snapshot.updatedAt <= nowMs
          ? snapshot
          : null;
      return ExpectedMoveResponseSchema.parse({
        underlying,
        anchor,
        generatedAt: nowMs,
        periodsPerYear: 365,
        index: 'DVOL',
        priceSource: 'aggregated-spot',
        liveIv: live?.current ?? null,
        liveIvAsOfMs: live?.updatedAt ?? null,
        current: sessions.find((s) => !s.complete) ?? null,
        history: sessions
          .filter((s) => s.complete)
          .slice(-days)
          .reverse(),
      });
    } catch (error: unknown) {
      req.log.warn({ error, underlying }, 'expected-move spot history unavailable');
      return reply.code(502).send({ error: 'Expected-move history unavailable' });
    }
  });

  app.get('/expected-move/straddle', async (req, reply) => {
    const parsed = ExpectedStraddleQuerySchema.safeParse(req.query);
    if (!parsed.success || parsed.data.underlying === 'SPX') {
      return reply.code(400).send({ error: 'Invalid crypto straddle query' });
    }
    const query = parsed.data;
    return straddles.get(`${query.underlying}:${query.venue}:${query.expiry}`, async () => {
      const nowMs = Date.now();
      const snapshot = isDvolReady() ? dvolService.getSnapshot(query.underlying) : null;
      const indexIv =
        snapshot != null && nowMs - snapshot.updatedAt <= 120_000 && snapshot.updatedAt <= nowMs
          ? snapshot.current
          : null;
      try {
        const venueChain = await getAdapter(query.venue as VenueId).fetchOptionChain(query);
        const comparison = buildComparisonChain(query.underlying, query.expiry, [venueChain]);
        const chain = buildEnrichedChain(query.underlying, query.expiry, comparison.rows, [
          venueChain,
        ]);
        return ExpectedStraddleResponseSchema.parse(
          evaluateExpectedStraddle(chain, query, indexIv, Date.now()),
        );
      } catch (error: unknown) {
        req.log.warn({ error, ...query }, 'expected-move straddle unavailable');
        return evaluateExpectedStraddle(null, query, indexIv, Date.now());
      }
    });
  });
}
