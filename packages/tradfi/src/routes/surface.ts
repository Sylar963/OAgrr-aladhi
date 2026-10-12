import {
  buildSurfaceAnalytics,
  buildSurfaceGridEntry,
  interpTenor,
  type IvSurfaceRow,
  type IvTenor,
  type SurfaceAnalytics,
  type SurfaceGridEntry,
  withFractionalDte,
} from '@oggregator/core';
import type { FastifyInstance } from 'fastify';
import type { TradfiDeps } from '../app.js';
import { buildVenueChain, TASTYTRADE_VENUE } from '../runtime/chain.js';
import type { VolHistorySource } from '../runtime/vol-history.js';
import { expiryCloseTs } from '../tastytrade/instrument.js';

export interface TradfiSurfaceResponse extends SurfaceAnalytics {
  /** Constant-maturity ATM IV interpolated in variance-time from the live surface. */
  atmIvTenors: Record<IvTenor, number | null>;
  atmIv30d: number | null;
  /** 21-trading-day close-to-close realized vol, the trading-day match for 30 calendar days. */
  rv30d: number | null;
  vrp30d: number | null;
}

const TENOR_DAYS: Record<IvTenor, number> = { '7d': 7, '30d': 30, '60d': 60, '90d': 90 };

export function atmIvTenors(rows: IvSurfaceRow[], now: number): Record<IvTenor, number | null> {
  const surfaces = withFractionalDte(rows, now, expiryCloseTs);
  const out = {} as Record<IvTenor, number | null>;
  for (const [tenor, days] of Object.entries(TENOR_DAYS) as [IvTenor, number][]) {
    out[tenor] = interpTenor(surfaces, days, 'atm');
  }
  return out;
}

const CACHE_TTL_MS = 10_000;
const VENUES = [TASTYTRADE_VENUE];

const yieldToEventLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

export function surfaceRoute(deps: TradfiDeps, volHistory?: VolHistorySource) {
  const cache = new Map<string, { at: number; response: Promise<TradfiSurfaceResponse> }>();

  async function build(underlying: string, expiries: string[]): Promise<TradfiSurfaceResponse> {
    const now = Date.now();
    const entries: SurfaceGridEntry[] = [];
    for (const expiry of expiries) {
      const expiryTs = deps.store.instrumentsFor(underlying, expiry)[0]?.expiryTs ?? null;
      if (expiryTs == null || expiryTs <= now) continue;
      deps.feed.ensureChainSubscribed(underlying, expiry);
      // One SVI fit per expiry; yield so a 50-expiry index doesn't block the loop.
      await yieldToEventLoop();
      const chain = buildVenueChain(deps.store, underlying, expiry);
      entries.push(buildSurfaceGridEntry(underlying, expiry, [chain], { venues: VENUES, expiryTs }));
    }
    const analytics = buildSurfaceAnalytics(underlying, entries, VENUES);
    const tenors = atmIvTenors(analytics.surface, now);
    const history = volHistory?.isReady() ? await volHistory.get(underlying) : null;
    const rv30d = history?.series.at(-1)?.rv ?? null;
    const atmIv30d = tenors['30d'];
    // A single venue's surface is the cross-venue surface, so reuse it rather than refit.
    return {
      ...analytics,
      venueSurfaceFine: { [TASTYTRADE_VENUE]: analytics.surfaceFine },
      venueSurfaceFineSmoothed: { [TASTYTRADE_VENUE]: analytics.surfaceFineSmoothed },
      venueSurfaceFineCmm: { [TASTYTRADE_VENUE]: analytics.surfaceFineCmm },
      atmIvTenors: tenors,
      atmIv30d,
      rv30d,
      vrp30d: atmIv30d != null && rv30d != null ? atmIv30d - rv30d : null,
    };
  }

  return async function (app: FastifyInstance) {
    app.get<{ Querystring: { underlying?: string } }>('/surface', async (req, reply) => {
      const underlying = req.query.underlying?.toUpperCase();
      if (!underlying) {
        return reply.status(400).send({ error: 'underlying query param required' });
      }
      if (!deps.feed.readiness().catalogLoaded) {
        return reply.status(503).send({ error: 'catalog not loaded' });
      }
      const hit = cache.get(underlying);
      if (hit != null && Date.now() - hit.at < CACHE_TTL_MS) return hit.response;
      // Only listed underlyings reach the cache, so arbitrary query strings can't grow it.
      const expiries = deps.store.listExpiries(underlying);
      if (expiries.length === 0) {
        return reply.status(404).send({ error: `unknown underlying ${underlying}` });
      }
      const response = build(underlying, expiries);
      cache.set(underlying, { at: Date.now(), response });
      response.catch(() => cache.delete(underlying));
      return response;
    });
  };
}
