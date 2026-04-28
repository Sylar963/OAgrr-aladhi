import type { FastifyInstance } from 'fastify';
import {
  buildIvSurfaceGrid,
  computeTermStructure,
  getAllAdapters,
  type IvSurfaceRow,
  type IvSurfaceFineRow,
  type TermStructure,
  type VenueId,
  VENUE_IDS,
  FINE_DELTA_GRID,
} from '@oggregator/core';

export async function surfaceRoute(app: FastifyInstance) {
  app.get<{
    Querystring: { underlying: string; venues?: string };
  }>('/surface', async (req, reply) => {
    const { underlying, venues: venuesParam } = req.query;

    if (!underlying) {
      return reply.status(400).send({ error: 'underlying query param required' });
    }

    const requestedVenues: VenueId[] = venuesParam
      ? (venuesParam.split(',').filter((v) => VENUE_IDS.includes(v as VenueId)) as VenueId[])
      : getAllAdapters().map((a) => a.venue);

    const entries = await buildIvSurfaceGrid({ underlying, venues: requestedVenues });

    const surface: IvSurfaceRow[] = new Array(entries.length);
    const surfaceFine: IvSurfaceFineRow[] = new Array(entries.length);
    const venueAtm: Record<string, Array<{ expiry: string; dte: number; atm: number | null }>> = {};
    for (const venueId of requestedVenues) {
      venueAtm[venueId] = [];
    }

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]!;
      surface[i] = entry.surfaceRow;
      surfaceFine[i] = entry.surfaceFineRow;
      for (const venueId of requestedVenues) {
        const callIv = entry.atmStrike?.call.venues[venueId]?.markIv ?? null;
        const putIv = entry.atmStrike?.put.venues[venueId]?.markIv ?? null;
        const iv =
          callIv != null && putIv != null ? (callIv + putIv) / 2 : (callIv ?? putIv);
        venueAtm[venueId]!.push({ expiry: entry.expiry, dte: entry.dte, atm: iv });
      }
    }

    const termStructure: TermStructure = computeTermStructure(surface);

    // Surface is deterministic per chain tick; allow a 1s shared cache so
    // bursts of clients hit a proxy cache instead of recomputing.
    reply.header('Cache-Control', 'public, max-age=0, s-maxage=1, stale-while-revalidate=2');

    return {
      underlying,
      surface,
      surfaceFine,
      surfaceFineDeltas: FINE_DELTA_GRID,
      termStructure,
      venueAtm,
    };
  });
}
