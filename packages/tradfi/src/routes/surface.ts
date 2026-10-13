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

export interface SmileStrikeRow {
  strike: number;
  callIv: number | null;
  callDelta: number | null;
  putIv: number | null;
  putDelta: number | null;
}

export interface ExpirySmile {
  expiry: string;
  referencePriceUsd: number | null;
  strikes: SmileStrikeRow[];
}

export interface TradfiSurfaceResponse extends SurfaceAnalytics {
  /** Per-expiry IV/delta by strike from the same snapshot, so the smile matches the surface. */
  smiles: ExpirySmile[];
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

const CACHE_TTL_MS = 4_000;
// A surface built while freshly subscribed chains are still empty must not be served for
// the full TTL: their greeks arrive within a second or two of subscribing.
const WARMING_CACHE_TTL_MS = 500;
const VENUES = [TASTYTRADE_VENUE];

const yieldToEventLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

// Five decimals is 0.001 vol points / 0.00001 delta — well below anything the smile chart shows.
const round5 = (v: number | null | undefined) => (v == null ? null : Math.round(v * 1e5) / 1e5);

export function smileFromEntry(entry: SurfaceGridEntry): ExpirySmile {
  const strikes: SmileStrikeRow[] = [];
  for (const s of entry.strikes) {
    const call = s.call.venues[TASTYTRADE_VENUE];
    const put = s.put.venues[TASTYTRADE_VENUE];
    const callIv = round5(call?.markIv);
    const putIv = round5(put?.markIv);
    if (callIv == null && putIv == null) continue;
    strikes.push({
      strike: s.strike,
      callIv,
      callDelta: round5(call?.delta),
      putIv,
      putDelta: round5(put?.delta),
    });
  }
  return { expiry: entry.expiry, referencePriceUsd: entry.referencePriceUsd, strikes };
}

export function surfaceRoute(deps: TradfiDeps, volHistory?: VolHistorySource) {
  const cache = new Map<string, { at: number; ttl: number; response: Promise<TradfiSurfaceResponse> }>();

  async function build(underlying: string, expiries: string[]): Promise<TradfiSurfaceResponse> {
    const now = Date.now();
    const entries: SurfaceGridEntry[] = [];
    for (const expiry of expiries) {
      const expiryTs = deps.store.instrumentsFor(underlying, expiry)[0]?.expiryTs ?? null;
      if (expiryTs == null || expiryTs <= now) continue;
      deps.feed.ensureChainSubscribed(underlying, expiry, 'surface');
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
      smiles: entries.map(smileFromEntry),
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
      if (hit != null && Date.now() - hit.at < hit.ttl) return hit.response;
      // Only listed underlyings reach the cache, so arbitrary query strings can't grow it.
      const expiries = deps.store.listExpiries(underlying);
      if (expiries.length === 0) {
        return reply.status(404).send({ error: `unknown underlying ${underlying}` });
      }
      const response = build(underlying, expiries);
      const entry = { at: Date.now(), ttl: CACHE_TTL_MS, response };
      cache.set(underlying, entry);
      response.then(
        (built) => {
          if (built.smiles.length === 0 || built.smiles.some((smile) => smile.strikes.length === 0)) {
            entry.ttl = WARMING_CACHE_TTL_MS;
          }
        },
        () => cache.delete(underlying),
      );
      return response;
    });
  };
}
