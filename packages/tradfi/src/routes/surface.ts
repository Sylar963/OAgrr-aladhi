import {
  buildSurfaceAnalytics,
  buildSurfaceGridEntry,
  type SurfaceAnalytics,
  type SurfaceGridEntry,
} from '@oggregator/core';
import type { FastifyInstance } from 'fastify';
import type { TradfiDeps } from '../app.js';
import { buildVenueChain, TASTYTRADE_VENUE } from '../runtime/chain.js';

export interface TradfiSurfaceResponse extends SurfaceAnalytics {
  atmIv30d: number | null;
  rv30d: number | null;
  vrp30d: number | null;
}

const CACHE_TTL_MS = 10_000;
const VENUES = [TASTYTRADE_VENUE];

const yieldToEventLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

export function surfaceRoute(deps: TradfiDeps) {
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
    // A single venue's surface is the cross-venue surface, so reuse it rather than refit.
    return {
      ...analytics,
      venueSurfaceFine: { [TASTYTRADE_VENUE]: analytics.surfaceFine },
      venueSurfaceFineSmoothed: { [TASTYTRADE_VENUE]: analytics.surfaceFineSmoothed },
      venueSurfaceFineCmm: { [TASTYTRADE_VENUE]: analytics.surfaceFineCmm },
      atmIv30d: null,
      rv30d: null,
      vrp30d: null,
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
