import {
  buildComparisonChain,
  buildEnrichedChain,
  type SpotCandle,
  type SpotCandleCurrency,
} from '@oggregator/core';
import {
  AlphaStraddleScannerQuerySchema,
  type AlphaStraddleCandidate,
  type AlphaStraddleScannerResponse,
} from '@oggregator/protocol';
import type { FastifyInstance } from 'fastify';

import { buildVenuePlan, createExpiryChainSource } from '../alpha-expiry-chains.js';
import { buildAlphaMarketContext } from '../alpha-market-context.js';
import {
  buildStraddleVolModel,
  computeStraddleCandidate,
  rankStraddleCandidates,
  selectAtmStrike,
  termStructureState,
  type StraddleIvSeries,
  type StraddleSkipReason,
} from '../alpha-straddle-scanner.js';
import { mergeIvSeries } from '../iv-baseline-history.js';
import { ResponseCache } from '../response-cache.js';
import {
  isIvHistoryReady,
  isSpotCandlesReady,
  ivBaselineHistory,
  ivHistoryService,
  spotCandleService,
  spotService,
} from '../services.js';

const RESPONSE_CACHE_TTL_MS = 5_000;
const SPOT_HISTORY_UNDERLYINGS = new Set<SpotCandleCurrency>(['BTC', 'ETH', 'HYPE']);

function expiryTimestamp(expiry: string, contractsExpiryTs: Array<number | null>): number | null {
  const reported = contractsExpiryTs.find((ts): ts is number => ts != null);
  if (reported != null) return reported;
  const parsed = Date.parse(`${expiry}T08:00:00Z`);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function alphaStraddleScannerRoute(app: FastifyInstance) {
  const chainSource = createExpiryChainSource(app, 'Alpha straddle scanner');
  const cache = new ResponseCache<AlphaStraddleScannerResponse>(RESPONSE_CACHE_TTL_MS, 64);

  app.get<{ Querystring: Record<string, string | undefined> }>(
    '/alpha/straddle-scanner',
    async (req, reply): Promise<AlphaStraddleScannerResponse | { error: string; details?: unknown }> => {
      const parsed = AlphaStraddleScannerQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return reply.status(400).send({
          error: 'invalid straddle scanner query',
          details: parsed.error.flatten(),
        });
      }
      const config = { ...parsed.data, venues: [...new Set(parsed.data.venues)].sort() };
      const nowMs = Date.now();
      const plans = await Promise.all(
        config.venues.map((venue) =>
          buildVenuePlan(venue, config.underlying, config.minDte, config.maxDte, nowMs),
        ),
      );
      await chainSource.syncSubscriptions(plans, config.underlying, nowMs);

      return cache.get(JSON.stringify(config), async () => {
        const scanNowMs = Date.now();
        let candles: SpotCandle[] = [];
        if (
          isSpotCandlesReady() &&
          SPOT_HISTORY_UNDERLYINGS.has(config.underlying as SpotCandleCurrency)
        ) {
          try {
            candles = await spotCandleService.getCandles(
              config.underlying as SpotCandleCurrency,
              86_400,
              200,
            );
          } catch (error: unknown) {
            req.log.warn({ error, underlying: config.underlying }, 'Straddle scanner spot history unavailable');
          }
        }
        const ivHistory = isIvHistoryReady() ? ivHistoryService.query(config.underlying, 90) : null;
        const context = buildAlphaMarketContext({
          underlying: config.underlying,
          nowMs: scanNowMs,
          spotPrice:
            spotService.getSnapshot(config.underlying)?.lastPrice ?? candles.at(-1)?.close ?? null,
          ivHistory,
          candles,
          regime: null,
        });
        let dailyIv: StraddleIvSeries = { '7d': [], '30d': [] };
        try {
          dailyIv = await ivBaselineHistory.get(config.underlying);
        } catch (error: unknown) {
          req.log.warn({ error, underlying: config.underlying }, 'Straddle scanner IV baseline history unavailable');
        }
        const model = buildStraddleVolModel(candles, {
          '7d': mergeIvSeries(dailyIv['7d'], ivHistory?.tenors['7d'].series ?? []),
          '30d': mergeIvSeries(dailyIv['30d'], ivHistory?.tenors['30d'].series ?? []),
        });
        const market = {
          termStructure: termStructureState(
            context.volatility.atmIv7d,
            context.volatility.atmIv30d,
          ),
          spotState: context.spotState.state,
        };

        const chains = await chainSource.fetchChains(plans, config.underlying, req.log);
        const candidates: AlphaStraddleCandidate[] = [];
        const skipped: Partial<Record<StraddleSkipReason | 'no_atm_strike' | 'missing_expiry', number>> = {};
        for (const { venue, expiry, chain } of chains) {
          const contracts = Object.values(chain.contracts);
          const expiryTs = expiryTimestamp(
            expiry,
            contracts.map((contract) => contract.expiryTs),
          );
          if (expiryTs == null || expiryTs <= scanNowMs) {
            skipped.missing_expiry = (skipped.missing_expiry ?? 0) + 1;
            continue;
          }
          const comparison = buildComparisonChain(config.underlying, expiry, [chain]);
          const enriched = buildEnrichedChain(config.underlying, expiry, comparison.rows, [chain]);
          const strike = selectAtmStrike(enriched.strikes, venue);
          if (strike == null) {
            skipped.no_atm_strike = (skipped.no_atm_strike ?? 0) + 1;
            continue;
          }
          const result = computeStraddleCandidate(
            { venue, underlying: config.underlying, expiry, expiryTs },
            strike,
            model,
            market,
            config,
            scanNowMs,
          );
          if (result.candidate != null) candidates.push(result.candidate);
          else skipped[result.skipReason] = (skipped[result.skipReason] ?? 0) + 1;
        }

        return {
          generatedAt: scanNowMs,
          underlying: config.underlying,
          venues: config.venues,
          config,
          forecast: model.forecast,
          context: {
            atmIv7d: context.volatility.atmIv7d,
            atmIv30d: context.volatility.atmIv30d,
            ivPercentile30d: context.volatility.ivPercentile30d,
            termStructure: market.termStructure,
            spotState: market.spotState,
          },
          venueStatus: plans.map((plan) => ({
            venue: plan.venue,
            eligibleExpiries: plan.expiries.length,
            error: plan.error,
          })),
          candidates: rankStraddleCandidates(candidates).slice(0, config.limit),
          skipped,
        };
      });
    },
  );
}
