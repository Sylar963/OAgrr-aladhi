import { getAdapter, type VenueSubscriptionHandle } from '@oggregator/core';
import {
  AlphaLottoScannerQuerySchema,
  type AlphaLottoScannerResponse,
} from '@oggregator/protocol';
import type { FastifyInstance } from 'fastify';

import {
  computeLottoCandidate,
  rankLottoCandidates,
  type ScannerMarketContext,
  type ScannerSkipReason,
} from '../alpha-lotto-scanner.js';
import { ResponseCache } from '../response-cache.js';
import { venueSubscriptions } from '../venue-subscriptions.js';

const INITIAL_QUOTE_WAIT_MS = 1_100;
const RESPONSE_CACHE_TTL_MS = 5_000;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function exactDte(expiryTs: number, nowMs: number): number {
  return (expiryTs - nowMs) / 86_400_000;
}

export async function alphaLottoScannerRoute(app: FastifyInstance) {
  const subscriptions = new Map<string, VenueSubscriptionHandle>();
  const cache = new ResponseCache<AlphaLottoScannerResponse>(RESPONSE_CACHE_TTL_MS, 64);
  let subscriptionSync: Promise<number> = Promise.resolve(0);

  async function syncSubscriptions(expiries: string[]): Promise<number> {
    subscriptionSync = subscriptionSync.then(async () => {
      const wanted = new Set(expiries);
      let added = 0;

      for (const expiry of expiries) {
        if (subscriptions.has(expiry)) continue;
        const handle = await venueSubscriptions.acquire('thalex', {
          underlying: 'BTC',
          expiry,
        });
        subscriptions.set(expiry, handle);
        added += 1;
      }

      for (const [expiry, handle] of subscriptions) {
        if (wanted.has(expiry)) continue;
        subscriptions.delete(expiry);
        await handle.release();
      }
      return added;
    });
    return subscriptionSync;
  }

  app.addHook('onClose', async () => {
    await subscriptionSync;
    await Promise.allSettled([...subscriptions.values()].map((handle) => handle.release()));
    subscriptions.clear();
  });

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

      const config = parsed.data;
      const adapter = getAdapter('thalex');
      const nowMs = Date.now();
      const expiryRows = (await adapter.listExpiryTimestamps?.('BTC')) ?? [];
      const eligibleExpiries = expiryRows
        .filter(
          (row): row is { expiry: string; expiryTs: number } =>
            row.expiryTs != null &&
            exactDte(row.expiryTs, nowMs) >= config.minDte &&
            exactDte(row.expiryTs, nowMs) <= config.maxDte,
        )
        .map((row) => row.expiry);

      const addedSubscriptions = await syncSubscriptions(eligibleExpiries);
      if (addedSubscriptions > 0) await wait(INITIAL_QUOTE_WAIT_MS);

      const cacheKey = JSON.stringify(config);
      return cache.get(cacheKey, async () => {
        const scanNowMs = Date.now();
        const chains = await Promise.all(
          eligibleExpiries.map((expiry) =>
            adapter.fetchOptionChain({ underlying: 'BTC', expiry }),
          ),
        );
        const contracts = chains.flatMap((chain) => Object.values(chain.contracts));
        const referenceContract = contracts.find(
          (contract) =>
            contract.quote.indexPriceUsd != null && contract.quote.underlyingPriceUsd != null,
        );
        const indexPrice = referenceContract?.quote.indexPriceUsd ?? null;
        const forwardPrice = referenceContract?.quote.underlyingPriceUsd ?? null;
        const skipped: Partial<Record<ScannerSkipReason, number>> = {};

        if (indexPrice == null || forwardPrice == null) {
          req.log.warn({ eligibleExpiries }, 'alpha lotto scanner has no market reference');
          return {
            generatedAt: scanNowMs,
            venue: 'thalex',
            underlying: 'BTC',
            indexPrice,
            forwardPrice,
            eligibleExpiries,
            config,
            candidates: [],
            skipped,
          };
        }

        const market: ScannerMarketContext = { indexPrice, forwardPrice, nowMs: scanNowMs };
        const candidates = [];
        for (const contract of contracts) {
          const result = computeLottoCandidate(contract, market, config);
          if (result.candidate != null) {
            candidates.push(result.candidate);
            continue;
          }
          skipped[result.skipReason] = (skipped[result.skipReason] ?? 0) + 1;
        }

        const ranked = rankLottoCandidates(candidates).slice(0, config.limit);
        req.log.debug(
          { eligibleExpiries, scanned: contracts.length, returned: ranked.length, skipped },
          'alpha lotto scan complete',
        );
        return {
          generatedAt: scanNowMs,
          venue: 'thalex',
          underlying: 'BTC',
          indexPrice,
          forwardPrice,
          eligibleExpiries,
          config,
          candidates: ranked,
          skipped,
        };
      });
    },
  );
}
