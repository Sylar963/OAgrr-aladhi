import type { FastifyBaseLogger } from 'fastify';
import { getAdapter, getRegisteredVenues, type VenueId } from '@oggregator/core';
import { chainEngines } from './chain-engines.js';

const WARMUP_UNDERLYINGS = ['BTC', 'ETH'] as const;
const WARMUP_EXPIRY_COUNT = 4;

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

  await Promise.allSettled(
    WARMUP_UNDERLYINGS.map(async (underlying) => {
      const expiries = await collectNearestExpiries(underlying, venues, log);
      if (expiries.length === 0) return;

      await Promise.allSettled(
        expiries.map(async (expiry) => {
          const start = Date.now();
          try {
            const { release } = await chainEngines.acquire({ underlying, expiry, venues });
            heldHandles.push({ release });
            log.info(
              { underlying, expiry, ms: Date.now() - start },
              'chain runtime warmed',
            );
          } catch (err: unknown) {
            log.warn(
              { underlying, expiry, err: err instanceof Error ? err.message : String(err) },
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
  return [...all].sort().slice(0, WARMUP_EXPIRY_COUNT);
}
