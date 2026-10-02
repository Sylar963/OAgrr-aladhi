import {
  buildComparisonChain,
  buildEnrichedChain,
  type EnrichedStrike,
  type SpotCandle,
  type SpotCandleCurrency,
  type VenueId,
} from '@oggregator/core';
import {
  AlphaLongStraddleScannerQuerySchema,
  AlphaStraddleScannerQuerySchema,
  type AlphaLongStraddleCandidate,
  type AlphaLongStraddleScannerResponse,
  type AlphaStraddleCandidate,
  type AlphaStraddleScannerResponse,
} from '@oggregator/protocol';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import { buildVenuePlan, createExpiryChainSource } from '../alpha-expiry-chains.js';
import {
  computeLongStraddleCandidate,
  rankLongStraddleCandidates,
  type LongStraddleSkipReason,
} from '../alpha-long-straddle-scanner.js';
import { buildAlphaMarketContext } from '../alpha-market-context.js';
import {
  buildStraddleVolModel,
  computeStraddleCandidate,
  rankStraddleCandidates,
  selectAtmStrike,
  termStructureState,
  withVenueBaseline,
  type StraddleExpiryInput,
  type StraddleIvSeries,
  type StraddleMarketContext,
  type StraddleSkipReason,
  type StraddleVolModel,
} from '../alpha-straddle-scanner.js';
import { mergeIvSeries } from '../iv-baseline-history.js';
import { ResponseCache } from '../response-cache.js';
import {
  isIvHistoryReady,
  isSpotCandlesReady,
  ivBaselineHistory,
  ivHistoryService,
  venueIvBaselineHistory,
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

interface AtmScanConfig {
  underlying: string;
  venues: VenueId[];
  minDte: number;
  maxDte: number;
}

interface AtmScanCompute<C, R extends string> {
  (
    input: StraddleExpiryInput,
    strike: EnrichedStrike,
    model: StraddleVolModel,
    market: StraddleMarketContext,
    nowMs: number,
  ): { candidate: C; skipReason: null } | { candidate: null; skipReason: R };
}

interface AtmScanResult<C> {
  generatedAt: number;
  forecast: AlphaStraddleScannerResponse['forecast'];
  context: AlphaStraddleScannerResponse['context'];
  venueStatus: AlphaStraddleScannerResponse['venueStatus'];
  candidates: C[];
  skipped: Record<string, number>;
}

function createAtmStraddleScan(app: FastifyInstance) {
  const chainSource = createExpiryChainSource(app, 'Alpha straddle scanner');

  async function plan(config: AtmScanConfig) {
    const nowMs = Date.now();
    const plans = await Promise.all(
      config.venues.map((venue) =>
        buildVenuePlan(venue, config.underlying, config.minDte, config.maxDte, nowMs),
      ),
    );
    await chainSource.syncSubscriptions(plans, config.underlying, nowMs);
    return plans;
  }

  async function scan<C, R extends string>(
    req: FastifyRequest,
    config: AtmScanConfig,
    plans: Awaited<ReturnType<typeof plan>>,
    compute: AtmScanCompute<C, R>,
  ): Promise<AtmScanResult<C>> {
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
    let storedIv: StraddleIvSeries = { '7d': [], '30d': [] };
    try {
      storedIv = await ivBaselineHistory.get(config.underlying);
    } catch (error: unknown) {
      req.log.warn({ error, underlying: config.underlying }, 'Straddle scanner IV baseline history unavailable');
    }
    const model = buildStraddleVolModel(candles, {
      '7d': mergeIvSeries(storedIv['7d'], ivHistory?.tenors['7d'].series ?? []),
      '30d': mergeIvSeries(storedIv['30d'], ivHistory?.tenors['30d'].series ?? []),
    });
    let venueIv: ReadonlyMap<string, StraddleIvSeries> = new Map();
    try {
      venueIv = await venueIvBaselineHistory.get(config.underlying);
    } catch (error: unknown) {
      req.log.warn({ error, underlying: config.underlying }, 'Straddle scanner venue IV history unavailable');
    }
    const venueModels = new Map<string, StraddleVolModel>();
    const modelFor = (venue: string): StraddleVolModel => {
      let venueModel = venueModels.get(venue);
      if (venueModel == null) {
        const series = venueIv.get(venue);
        venueModel = withVenueBaseline(
          model,
          series == null ? null : buildStraddleVolModel(candles, series, 'venue'),
        );
        venueModels.set(venue, venueModel);
      }
      return venueModel;
    };
    const market: StraddleMarketContext = {
      termStructure: termStructureState(
        context.volatility.atmIv7d,
        context.volatility.atmIv30d,
      ),
      spotState: context.spotState.state,
    };

    const chains = await chainSource.fetchChains(plans, config.underlying, req.log);
    const candidates: C[] = [];
    const skipped: Record<string, number> = {};
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
      const result = compute(
        { venue, underlying: config.underlying, expiry, expiryTs },
        strike,
        modelFor(venue),
        market,
        scanNowMs,
      );
      if (result.candidate != null) candidates.push(result.candidate);
      else if (result.skipReason != null) {
        skipped[result.skipReason] = (skipped[result.skipReason] ?? 0) + 1;
      }
    }

    return {
      generatedAt: scanNowMs,
      forecast: model.forecast,
      context: {
        atmIv7d: context.volatility.atmIv7d,
        atmIv30d: context.volatility.atmIv30d,
        ivPercentile30d: context.volatility.ivPercentile30d,
        termStructure: market.termStructure,
        spotState: market.spotState,
      },
      venueStatus: plans.map((venuePlan) => ({
        venue: venuePlan.venue,
        eligibleExpiries: venuePlan.expiries.length,
        error: venuePlan.error,
      })),
      candidates,
      skipped,
    };
  }

  return { plan, scan };
}

export async function alphaStraddleScannerRoute(app: FastifyInstance) {
  const atmScan = createAtmStraddleScan(app);
  const cache = new ResponseCache<AlphaStraddleScannerResponse>(RESPONSE_CACHE_TTL_MS, 64);
  const longCache = new ResponseCache<AlphaLongStraddleScannerResponse>(RESPONSE_CACHE_TTL_MS, 64);

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
      const plans = await atmScan.plan(config);

      return cache.get(JSON.stringify(config), async () => {
        const result = await atmScan.scan<AlphaStraddleCandidate, StraddleSkipReason>(
          req,
          config,
          plans,
          (input, strike, model, market, nowMs) =>
            computeStraddleCandidate(input, strike, model, market, config, nowMs),
        );
        return {
          ...result,
          underlying: config.underlying,
          venues: config.venues,
          config,
          candidates: rankStraddleCandidates(result.candidates).slice(0, config.limit),
        };
      });
    },
  );

  app.get<{ Querystring: Record<string, string | undefined> }>(
    '/alpha/long-straddle-scanner',
    async (req, reply): Promise<AlphaLongStraddleScannerResponse | { error: string; details?: unknown }> => {
      const parsed = AlphaLongStraddleScannerQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return reply.status(400).send({
          error: 'invalid long straddle scanner query',
          details: parsed.error.flatten(),
        });
      }
      const config = { ...parsed.data, venues: [...new Set(parsed.data.venues)].sort() };
      const plans = await atmScan.plan(config);

      return longCache.get(JSON.stringify(config), async () => {
        const result = await atmScan.scan<AlphaLongStraddleCandidate, LongStraddleSkipReason>(
          req,
          config,
          plans,
          (input, strike, model, market, nowMs) =>
            computeLongStraddleCandidate(input, strike, model, market, config, nowMs),
        );
        return {
          ...result,
          underlying: config.underlying,
          venues: config.venues,
          config,
          candidates: rankLongStraddleCandidates(result.candidates).slice(0, config.limit),
        };
      });
    },
  );
}
