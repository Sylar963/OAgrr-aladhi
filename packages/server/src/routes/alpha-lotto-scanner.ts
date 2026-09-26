import type { NormalizedOptionContract } from '@oggregator/core';
import {
  AlphaLottoScannerQuerySchema,
  type AlphaLottoCandidate,
  type AlphaLottoScannerResponse,
} from '@oggregator/protocol';
import type { FastifyInstance } from 'fastify';

import {
  addLegacyLottoAliases,
  computeLottoCandidate,
  rankLottoCandidates,
  rankLottoCandidatesAcrossExpiries,
  type ScannerMarketContext,
  type ScannerSkipReason,
} from '../alpha-lotto-scanner.js';
import { buildVenuePlan, createExpiryChainSource } from '../alpha-expiry-chains.js';
import { ResponseCache } from '../response-cache.js';
import { spotService } from '../services.js';

const RESPONSE_CACHE_TTL_MS = 5_000;

function readMarketReference(contracts: NormalizedOptionContract[]): {
  indexPrice: number | null;
  forwardPrice: number | null;
} {
  return {
    indexPrice:
      contracts.find((contract) => contract.quote.indexPriceUsd != null)?.quote.indexPriceUsd ??
      null,
    forwardPrice:
      contracts.find((contract) => contract.quote.underlyingPriceUsd != null)?.quote
        .underlyingPriceUsd ?? null,
  };
}

function estimateAtmIv(contracts: NormalizedOptionContract[], indexPrice: number): number | null {
  let nearestDistance = Infinity;
  let nearestStrike: number | null = null;
  for (const contract of contracts) {
    const distance = Math.abs(contract.strike - indexPrice);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestStrike = contract.strike;
    }
  }
  if (nearestStrike == null) return null;
  const values = contracts
    .filter((contract) => contract.strike === nearestStrike && contract.greeks.markIv != null)
    .map((contract) => contract.greeks.markIv as number);
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

export async function alphaLottoScannerRoute(app: FastifyInstance) {
  const chainSource = createExpiryChainSource(app, 'Alpha scanner');
  const cache = new ResponseCache<AlphaLottoScannerResponse>(RESPONSE_CACHE_TTL_MS, 64);

  app.get<{ Querystring: Record<string, string | undefined> }>(
    '/alpha/lotto-scanner',
    async (req, reply): Promise<AlphaLottoScannerResponse | { error: string; details?: unknown }> => {
      const parsed = AlphaLottoScannerQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return reply.status(400).send({
          error: 'invalid scanner query',
          details: parsed.error.flatten(),
        });
      }

      const config = {
        ...parsed.data,
        venues: [...new Set(parsed.data.venues)].sort(),
      };
      const legacyRequest = req.query.underlying == null && req.query.venues == null;
      const nowMs = Date.now();
      const plans = await Promise.all(
        config.venues.map((venue) =>
          buildVenuePlan(venue, config.underlying, config.minDte, config.maxDte, nowMs),
        ),
      );
      await chainSource.syncSubscriptions(plans, config.underlying, nowMs);

      const cacheKey = JSON.stringify(config);
      const response = await cache.get(cacheKey, async () => {
        const scanNowMs = Date.now();
        const chains = await chainSource.fetchChains(plans, config.underlying, req.log);

        const candidates: AlphaLottoCandidate[] = [];
        const skipped: Partial<Record<ScannerSkipReason, number>> = {};
        const indexPrices: number[] = [];
        const forwardPrices: number[] = [];
        const spotProxy = spotService.getSnapshot(config.underlying)?.lastPrice ?? null;
        for (const { chain } of chains) {
          const contracts = Object.values(chain.contracts);
          const reference = readMarketReference(contracts);
          const chainIndexPrice = reference.indexPrice ?? spotProxy;
          const chainForwardPrice = reference.forwardPrice ?? chainIndexPrice;
          if (chainIndexPrice != null) indexPrices.push(chainIndexPrice);
          if (chainForwardPrice != null) forwardPrices.push(chainForwardPrice);
          const atmIv =
            chainIndexPrice == null ? null : estimateAtmIv(contracts, chainIndexPrice);
          for (const contract of contracts) {
            const indexPrice = contract.quote.indexPriceUsd ?? chainIndexPrice;
            const forwardPrice = contract.quote.underlyingPriceUsd ?? chainForwardPrice;
            const market: ScannerMarketContext = {
              indexPrice: indexPrice ?? 0,
              forwardPrice: forwardPrice ?? 0,
              referenceSource:
                contract.quote.underlyingPriceUsd != null || reference.forwardPrice != null
                  ? 'venue-forward'
                  : 'spot-proxy',
              atmIv,
              nowMs: scanNowMs,
            };
            const result = computeLottoCandidate(contract, market, config);
            if (result.candidate != null) {
              candidates.push(result.candidate);
            } else {
              skipped[result.skipReason] = (skipped[result.skipReason] ?? 0) + 1;
            }
          }
        }

        const ranked = config.diversifyExpiries
          ? rankLottoCandidatesAcrossExpiries(candidates, config.limit)
          : rankLottoCandidates(candidates).slice(0, config.limit);
        const eligibleExpiries = [...new Set(plans.flatMap((plan) => plan.expiries))].sort();
        const venueStatus = plans.map((plan) => ({
          venue: plan.venue,
          eligibleExpiries: plan.expiries.length,
          scannedContracts: chains
            .filter((entry) => entry.venue === plan.venue)
            .reduce((sum, entry) => sum + Object.keys(entry.chain.contracts).length, 0),
          error: plan.error,
        }));
        req.log.debug(
          {
            underlying: config.underlying,
            venues: config.venues,
            scanned: venueStatus.reduce((sum, status) => sum + status.scannedContracts, 0),
            returned: ranked.length,
            skipped,
          },
          'Alpha lotto scan complete',
        );
        return {
          generatedAt: scanNowMs,
          venues: config.venues,
          underlying: config.underlying,
          indexPrice:
            indexPrices.length === 0
              ? null
              : indexPrices.reduce((sum, value) => sum + value, 0) / indexPrices.length,
          forwardPrice:
            forwardPrices.length === 0
              ? null
              : forwardPrices.reduce((sum, value) => sum + value, 0) / forwardPrices.length,
          eligibleExpiries,
          venueStatus,
          config,
          candidates: ranked,
          skipped,
        };
      });
      return legacyRequest ? addLegacyLottoAliases(response) : response;
    },
  );
}
