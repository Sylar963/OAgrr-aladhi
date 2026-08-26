import {
  getAdapter,
  type NormalizedOptionContract,
  type VenueId,
  type VenueOptionChain,
  type VenueSubscriptionHandle,
} from '@oggregator/core';
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
  type ScannerMarketContext,
  type ScannerSkipReason,
} from '../alpha-lotto-scanner.js';
import { ResponseCache } from '../response-cache.js';
import { spotService } from '../services.js';
import { venueSubscriptions } from '../venue-subscriptions.js';

const INITIAL_QUOTE_WAIT_MS = 1_100;
const RESPONSE_CACHE_TTL_MS = 5_000;
const SUBSCRIPTION_IDLE_MS = 30_000;

interface SubscriptionEntry {
  handle: VenueSubscriptionHandle;
  lastUsedAt: number;
}

interface VenueScanPlan {
  venue: VenueId;
  expiries: string[];
  error: string | null;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function exactDte(expiryTs: number, nowMs: number): number {
  return (expiryTs - nowMs) / 86_400_000;
}

function expiryTimestamp(expiry: string): number | null {
  const timestamp = Date.parse(`${expiry}T08:00:00Z`);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function subscriptionKey(venue: VenueId, underlying: string, expiry: string): string {
  return `${venue}:${underlying}:${expiry}`;
}

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

async function buildVenuePlan(
  venue: VenueId,
  underlying: string,
  minDte: number,
  maxDte: number,
  nowMs: number,
): Promise<VenueScanPlan> {
  try {
    const adapter = getAdapter(venue);
    const timestampRows = await adapter.listExpiryTimestamps?.(underlying);
    const rows =
      timestampRows ??
      (await adapter.listExpiries(underlying)).map((expiry) => ({
        expiry,
        expiryTs: expiryTimestamp(expiry),
      }));
    const expiries = rows.flatMap((row) => {
      const expiryTs = row.expiryTs ?? expiryTimestamp(row.expiry);
      if (
        expiryTs == null ||
        exactDte(expiryTs, nowMs) < minDte ||
        exactDte(expiryTs, nowMs) > maxDte
      ) {
        return [];
      }
      return [row.expiry];
    });
    return { venue, expiries, error: null };
  } catch (error: unknown) {
    return { venue, expiries: [], error: error instanceof Error ? error.message : String(error) };
  }
}

export async function alphaLottoScannerRoute(app: FastifyInstance) {
  const subscriptions = new Map<string, SubscriptionEntry>();
  const cache = new ResponseCache<AlphaLottoScannerResponse>(RESPONSE_CACHE_TTL_MS, 64);
  let subscriptionSync: Promise<number> = Promise.resolve(0);

  async function syncSubscriptions(
    plans: VenueScanPlan[],
    underlying: string,
    nowMs: number,
  ): Promise<number> {
    subscriptionSync = subscriptionSync
      .catch((error: unknown) => {
        app.log.warn({ err: error }, 'Alpha scanner subscription sync recovered');
        return 0;
      })
      .then(async () => {
        const wanted = new Set<string>();
        let added = 0;
        for (const plan of plans) {
          for (const expiry of plan.expiries) {
            const key = subscriptionKey(plan.venue, underlying, expiry);
            wanted.add(key);
            const existing = subscriptions.get(key);
            if (existing) {
              existing.lastUsedAt = nowMs;
              continue;
            }
            try {
              const handle = await venueSubscriptions.acquire(plan.venue, { underlying, expiry });
              subscriptions.set(key, { handle, lastUsedAt: nowMs });
              added += 1;
            } catch (error: unknown) {
              plan.error ??= error instanceof Error ? error.message : String(error);
            }
          }
        }
        for (const [key, entry] of subscriptions) {
          if (wanted.has(key) || nowMs - entry.lastUsedAt <= SUBSCRIPTION_IDLE_MS) continue;
          subscriptions.delete(key);
          try {
            await entry.handle.release();
          } catch (error: unknown) {
            app.log.warn(
              { err: error, subscription: key },
              'Alpha scanner subscription release failed',
            );
          }
        }
        if (added > 0) await wait(INITIAL_QUOTE_WAIT_MS);
        return added;
      });
    return subscriptionSync;
  }

  const idleCleanup = setInterval(() => {
    void syncSubscriptions([], '', Date.now());
  }, SUBSCRIPTION_IDLE_MS);
  idleCleanup.unref();

  app.addHook('onClose', async () => {
    clearInterval(idleCleanup);
    await subscriptionSync;
    await Promise.allSettled([...subscriptions.values()].map((entry) => entry.handle.release()));
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
      await syncSubscriptions(plans, config.underlying, nowMs);

      const cacheKey = JSON.stringify(config);
      const response = await cache.get(cacheKey, async () => {
        const scanNowMs = Date.now();
        const chainRequests = plans.flatMap((plan) =>
          plan.expiries.map((expiry) => ({ venue: plan.venue, expiry })),
        );
        const settled = await Promise.allSettled(
          chainRequests.map(async ({ venue, expiry }) => ({
            venue,
            expiry,
            chain: await getAdapter(venue).fetchOptionChain({
              underlying: config.underlying,
              expiry,
            }),
          })),
        );
        const chains: Array<{ venue: VenueId; expiry: string; chain: VenueOptionChain }> = [];
        for (let index = 0; index < settled.length; index += 1) {
          const result = settled[index]!;
          if (result.status === 'fulfilled') {
            chains.push(result.value);
            continue;
          }
          const request = chainRequests[index]!;
          const plan = plans.find((entry) => entry.venue === request.venue);
          const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
          if (plan) plan.error ??= message;
          req.log.warn(
            { err: result.reason, venue: request.venue, expiry: request.expiry },
            'Alpha scanner venue chain fetch failed',
          );
        }

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

        const ranked = rankLottoCandidates(candidates).slice(0, config.limit);
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
