import { evaluateExpectedStraddle } from '@oggregator/core';
import {
  ExpectedMoveQuerySchema,
  ExpectedMoveResponseSchema,
  ExpectedStraddleQuerySchema,
  ExpectedStraddleResponseSchema,
} from '@oggregator/protocol';
import type { FastifyInstance } from 'fastify';
import type { TradfiDeps } from '../app.js';
import { buildChain } from '../runtime/chain.js';
import { SpxMoveSource } from '../runtime/expected-move.js';

export function expectedMoveRoute(deps: TradfiDeps) {
  const source = deps.candleClient == null ? null : new SpxMoveSource(deps.candleClient);
  return async (app: FastifyInstance) => {
    app.get('/expected-move', async (req, reply) => {
      const parsed = ExpectedMoveQuerySchema.safeParse(req.query);
      if (!parsed.success || parsed.data.underlying !== 'SPX') {
        return reply.code(400).send({ error: 'Invalid SPX expected-move query' });
      }
      if (source == null || !deps.candleClient?.isReady()) {
        return reply.code(503).send({ error: 'candle feed not ready' });
      }
      try {
        const report = await source.get();
        return ExpectedMoveResponseSchema.parse({
          ...report,
          history: report.history.slice(0, parsed.data.days),
        });
      } catch (error: unknown) {
        req.log.warn({ error }, 'SPX expected-move history unavailable');
        return reply.code(502).send({ error: 'SPX expected-move history unavailable' });
      }
    });

    app.get('/expected-move/straddle', async (req, reply) => {
      const parsed = ExpectedStraddleQuerySchema.safeParse(req.query);
      if (!parsed.success || parsed.data.underlying !== 'SPX') {
        return reply.code(400).send({ error: 'Invalid SPX straddle query' });
      }
      const query = parsed.data;
      if (!deps.feed.readiness().catalogLoaded) {
        return reply.code(503).send({ error: 'catalog not loaded' });
      }
      let indexIv: number | null = null;
      if (source != null && deps.candleClient?.isReady()) {
        try {
          indexIv = (await source.get()).liveIv;
        } catch (error: unknown) {
          req.log.warn({ error }, 'SPX straddle VIX unavailable');
        }
      }
      if (deps.store.instrumentsFor('SPX', query.expiry).length === 0) {
        return evaluateExpectedStraddle(null, query, indexIv, Date.now());
      }
      deps.feed.ensureChainSubscribed('SPX', query.expiry);
      if (Date.now() - deps.store.newestQuoteTs('SPX', query.expiry) > 90_000) {
        try {
          await deps.feed.refreshChainQuotes('SPX', query.expiry);
        } catch (error: unknown) {
          req.log.warn({ error }, 'SPX straddle quotes unavailable');
        }
      }
      return ExpectedStraddleResponseSchema.parse(
        evaluateExpectedStraddle(
          buildChain(deps.store, 'SPX', query.expiry, 'ws', deps.flowBook),
          query,
          indexIv,
          Date.now(),
        ),
      );
    });
  };
}
