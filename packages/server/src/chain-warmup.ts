import type { FastifyBaseLogger } from 'fastify';
import { getAdapter, getRegisteredVenues, type VenueId } from '@oggregator/core';
import { chainEngines } from './chain-engines.js';

// Hot tier: full chain runtime acquired with N nearest expiries.
// These are the underlyings that take >90% of user traffic.
const HOT_UNDERLYINGS = ['BTC', 'ETH', 'BTC_USDC', 'ETH_USDC', 'SOL_USDC'] as const;
const HOT_EXPIRY_COUNT = 12;

// Warm tier: same flow, fewer expiries. Cuts cold-start to ~ms when a user
// clicks one of these (they don't get a per-strike ticker firehose at boot,
// but the bulk channels are already live via the adapter's eagerSubscribe).
const WARM_UNDERLYINGS = ['AVAX_USDC', 'XRP_USDC', 'TRX_USDC'] as const;
const WARM_EXPIRY_COUNT = 6;

// Hold pre-warm handles for the lifetime of the process so the runtimes stay
// pinned in the registry. Without this, a 15-min idle period after boot would
// let them drain back to cold.
const heldHandles: Array<{ release: () => Promise<void> }> = [];

/**
 * Acquires chain runtimes for the hottest underlyings × nearest expiries × all
 * venues right after adapter bootstrap. The first user-facing Vol Smile request
 * then sees an already-built snapshot instead of doing 8 sequential WS
 * subscribes per expiry.
 */
export async function warmupChainRuntimes(log: FastifyBaseLogger): Promise<void> {
  const venues = getRegisteredVenues() as VenueId[];
  if (venues.length === 0) {
    log.warn('chain warmup skipped — no adapters registered');
    return;
  }

  await Promise.allSettled([
    warmupTier(HOT_UNDERLYINGS, HOT_EXPIRY_COUNT, venues, log, 'hot'),
    warmupTier(WARM_UNDERLYINGS, WARM_EXPIRY_COUNT, venues, log, 'warm'),
  ]);
}

async function warmupTier(
  underlyings: readonly string[],
  expiryCount: number,
  venues: VenueId[],
  log: FastifyBaseLogger,
  tier: 'hot' | 'warm',
): Promise<void> {
  await Promise.allSettled(
    underlyings.map(async (underlying) => {
      const expiries = await collectNearestExpiries(underlying, venues, log, expiryCount);
      if (expiries.length === 0) return;
      await Promise.allSettled(
        expiries.map(async (expiry) => {
          const start = Date.now();
          try {
            const { release } = await chainEngines.acquire({ underlying, expiry, venues });
            heldHandles.push({ release });
            log.info({ underlying, expiry, tier, ms: Date.now() - start }, 'chain runtime warmed');
          } catch (err: unknown) {
            log.warn(
              { underlying, expiry, tier, err: err instanceof Error ? err.message : String(err) },
              'chain runtime warmup failed',
            );
          }
        }),
      );
    }),
  );
}

export async function disposeChainWarmup(): Promise<void> {
  const handles = heldHandles.splice(0, heldHandles.length);
  await Promise.allSettled(handles.map(async (h) => h.release()));
}

async function collectNearestExpiries(
  underlying: string,
  venues: VenueId[],
  log: FastifyBaseLogger,
  count: number,
): Promise<string[]> {
  const all = new Set<string>();
  await Promise.allSettled(
    venues.map(async (venueId) => {
      try {
        const expiries = await getAdapter(venueId).listExpiries(underlying);
        for (const e of expiries) all.add(e);
      } catch (err: unknown) {
        log.warn(
          { venue: venueId, underlying, err: err instanceof Error ? err.message : String(err) },
          'listExpiries failed during warmup',
        );
      }
    }),
  );
  return [...all].sort().slice(0, count);
}
