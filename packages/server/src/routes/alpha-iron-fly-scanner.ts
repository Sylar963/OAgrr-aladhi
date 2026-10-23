import { buildComparisonChain, buildEnrichedChain, type SpotCandle } from '@oggregator/core';
import {
  AlphaIronFlyScannerQuerySchema,
  isSpotCandleUnderlying,
  SPOT_CANDLE_UNDERLYINGS,
  type AlphaIronFlyCandidate,
  type AlphaIronFlyScannerResponse,
  type AlphaIronFlyWindowSet,
} from '@oggregator/protocol';
import type { FastifyInstance } from 'fastify';

import { buildVenuePlan, createExpiryChainSource } from '../alpha-expiry-chains.js';
import {
  comparableWindows,
  computeIronFlyCandidates,
  HOLDOUT_WEEKS,
  rankIronFlyCandidates,
} from '../alpha-iron-fly-scanner.js';
import { ResponseCache } from '../response-cache.js';
import { isSpotCandlesReady, spotCandleService } from '../services.js';

const RESPONSE_CACHE_TTL_MS = 5_000;
const HISTORY_CACHE_TTL_MS = 30 * 60_000;
const WEEK_MS = 7 * 86_400_000;
// One max-span pull per underlying serves every lookback; the extra weeks cover expiries up
// to a month out.
const HISTORY_SPAN_MS = (312 + 5) * WEEK_MS;

function expiryTimestamp(expiry: string, contractsExpiryTs: Array<number | null>): number | null {
  const reported = contractsExpiryTs.find((ts): ts is number => ts != null);
  if (reported != null) return reported;
  const parsed = Date.parse(`${expiry}T08:00:00Z`);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function alphaIronFlyScannerRoute(app: FastifyInstance) {
  const chainSource = createExpiryChainSource(app, 'Alpha iron fly scanner');
  const cache = new ResponseCache<AlphaIronFlyScannerResponse>(RESPONSE_CACHE_TTL_MS, 64);
  const historyCache = new ResponseCache<SpotCandle[]>(
    HISTORY_CACHE_TTL_MS,
    SPOT_CANDLE_UNDERLYINGS.length,
  );

  app.get<{ Querystring: Record<string, string | undefined> }>(
    '/alpha/iron-fly-scanner',
    async (req, reply): Promise<AlphaIronFlyScannerResponse | { error: string; details?: unknown }> => {
      const parsed = AlphaIronFlyScannerQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return reply.status(400).send({
          error: 'invalid iron fly scanner query',
          details: parsed.error.flatten(),
        });
      }
      const config = { ...parsed.data, venues: [...new Set(parsed.data.venues)].sort() };
      const planNowMs = Date.now();
      const plans = await Promise.all(
        config.venues.map((venue) =>
          buildVenuePlan(venue, config.underlying, config.minDte, config.maxDte, planNowMs),
        ),
      );
      await chainSource.syncSubscriptions(plans, config.underlying, planNowMs);

      return cache.get(JSON.stringify(config), async () => {
        const nowMs = Date.now();
        const underlying = config.underlying;
        let candles: SpotCandle[] = [];
        if (isSpotCandlesReady() && isSpotCandleUnderlying(underlying)) {
          try {
            candles = await historyCache.get(underlying, () =>
              spotCandleService.getCandleHistory(underlying, 3600, HISTORY_SPAN_MS),
            );
          } catch (error: unknown) {
            req.log.warn({ error, underlying }, 'Iron fly scanner hourly history unavailable');
          }
        }

        const chains = await chainSource.fetchChains(plans, underlying, req.log);
        const windowsByExpiry = new Map<number, AlphaIronFlyWindowSet>();
        const candidates: AlphaIronFlyCandidate[] = [];
        const skipped: Record<string, number> = {};
        const skip = (reason: string) => {
          skipped[reason] = (skipped[reason] ?? 0) + 1;
        };
        for (const { venue, expiry, chain } of chains) {
          const contracts = Object.values(chain.contracts);
          const expiryTs = expiryTimestamp(expiry, contracts.map((contract) => contract.expiryTs));
          if (expiryTs == null || expiryTs <= nowMs) {
            skip('missing_expiry');
            continue;
          }
          let windows = windowsByExpiry.get(expiryTs);
          if (windows == null) {
            windows = comparableWindows(candles, nowMs, expiryTs, config.lookbackWeeks);
            windowsByExpiry.set(expiryTs, windows);
          }
          const comparison = buildComparisonChain(underlying, expiry, [chain]);
          const enriched = buildEnrichedChain(underlying, expiry, comparison.rows, [chain]);
          const results = computeIronFlyCandidates(
            { venue, underlying, expiry, expiryTs },
            enriched.strikes,
            windows,
            config,
            nowMs,
          );
          for (const result of results) {
            if (result.candidate != null) candidates.push(result.candidate);
            else skip(result.skipReason);
          }
        }

        return {
          generatedAt: nowMs,
          underlying,
          venues: config.venues,
          config,
          history: {
            source: isSpotCandleUnderlying(underlying)
              ? `${underlying} perp hourly closes`
              : 'unavailable',
            available: candles.length > 0,
            holdoutWeeks: HOLDOUT_WEEKS,
            firstCandleTs: candles[0]?.timestamp ?? null,
          },
          windows: [...windowsByExpiry.values()].sort((a, b) => a.expiryTs - b.expiryTs),
          venueStatus: plans.map((plan) => ({
            venue: plan.venue,
            eligibleExpiries: plan.expiries.length,
            error: plan.error,
          })),
          candidates: rankIronFlyCandidates(candidates).slice(0, config.limit),
          skipped,
        };
      });
    },
  );
}
