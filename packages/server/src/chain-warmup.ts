import type { FastifyBaseLogger } from 'fastify';
import { getAdapter, getRegisteredVenues, type VenueId } from '@oggregator/core';
import { chainEngines } from './chain-engines.js';

// Live runtime warmup pins active venue subscriptions. Keep it opt-in because
// Deribit 100ms ticker channels scale with every warmed expiry.
const CHAIN_WARMUP_ENABLED = process.env['CHAIN_WARMUP_ENABLED'] === 'true';

const HOT_UNDERLYINGS = ['BTC', 'ETH', 'BTC_USDC', 'ETH_USDC', 'SOL_USDC'] as const;
const HOT_EXPIRY_COUNT = 4;

const WARM_UNDERLYINGS = ['AVAX_USDC', 'XRP_USDC', 'TRX_USDC'] as const;
const WARM_EXPIRY_COUNT = 2;

const heldHandles: Array<{ release: () => Promise<void> }> = [];

export async function warmupChainRuntimes(log: FastifyBaseLogger): Promise<void> {
  if (!CHAIN_WARMUP_ENABLED) {
    log.info('chain runtime warmup disabled');
    return;
  }

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
