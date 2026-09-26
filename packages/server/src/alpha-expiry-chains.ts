import {
  getAdapter,
  type VenueId,
  type VenueOptionChain,
  type VenueSubscriptionHandle,
} from '@oggregator/core';
import type { FastifyInstance } from 'fastify';

import { venueSubscriptions } from './venue-subscriptions.js';

const INITIAL_QUOTE_WAIT_MS = 1_100;
const SUBSCRIPTION_IDLE_MS = 30_000;

interface SubscriptionEntry {
  handle: VenueSubscriptionHandle;
  lastUsedAt: number;
}

export interface VenueScanPlan {
  venue: VenueId;
  expiries: string[];
  error: string | null;
}

export interface FetchedExpiryChain {
  venue: VenueId;
  expiry: string;
  chain: VenueOptionChain;
}

interface ChainLog {
  warn: (obj: object, msg: string) => void;
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

export async function buildVenuePlan(
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

/**
 * Keeps venue subscriptions warm for the expiries an Alpha scanner reads, and releases
 * them once no scan has asked for them within the idle window.
 */
export function createExpiryChainSource(app: FastifyInstance, label: string) {
  const subscriptions = new Map<string, SubscriptionEntry>();
  let subscriptionSync: Promise<number> = Promise.resolve(0);

  async function syncSubscriptions(
    plans: VenueScanPlan[],
    underlying: string,
    nowMs: number,
  ): Promise<number> {
    subscriptionSync = subscriptionSync
      .catch((error: unknown) => {
        app.log.warn({ err: error }, `${label} subscription sync recovered`);
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
            app.log.warn({ err: error, subscription: key }, `${label} subscription release failed`);
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

  async function fetchChains(
    plans: VenueScanPlan[],
    underlying: string,
    log: ChainLog,
  ): Promise<FetchedExpiryChain[]> {
    const chainRequests = plans.flatMap((plan) =>
      plan.expiries.map((expiry) => ({ venue: plan.venue, expiry })),
    );
    const settled = await Promise.allSettled(
      chainRequests.map(async ({ venue, expiry }) => ({
        venue,
        expiry,
        chain: await getAdapter(venue).fetchOptionChain({ underlying, expiry }),
      })),
    );
    const chains: FetchedExpiryChain[] = [];
    for (let index = 0; index < settled.length; index += 1) {
      const result = settled[index]!;
      if (result.status === 'fulfilled') {
        chains.push(result.value);
        continue;
      }
      const request = chainRequests[index]!;
      const plan = plans.find((entry) => entry.venue === request.venue);
      const message =
        result.reason instanceof Error ? result.reason.message : String(result.reason);
      if (plan) plan.error ??= message;
      log.warn(
        { err: result.reason, venue: request.venue, expiry: request.expiry },
        `${label} venue chain fetch failed`,
      );
    }
    return chains;
  }

  return { syncSubscriptions, fetchChains };
}
