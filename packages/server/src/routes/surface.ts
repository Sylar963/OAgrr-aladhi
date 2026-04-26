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

    const surface: IvSurfaceRow[] = entries.map((e) => e.surfaceRow);
    const surfaceFine: IvSurfaceFineRow[] = entries.map((e) => e.surfaceFineRow);
    const venueAtm: Record<string, Array<{ expiry: string; dte: number; atm: number | null }>> = {};
    for (const venueId of requestedVenues) {
      venueAtm[venueId] = [];
    }

    for (const entry of entries) {
      for (const venueId of requestedVenues) {
        const callIv = entry.atmStrike?.call.venues[venueId]?.markIv ?? null;
        const putIv = entry.atmStrike?.put.venues[venueId]?.markIv ?? null;
        const iv =
          callIv != null && putIv != null ? (callIv + putIv) / 2 : (callIv ?? putIv);
        venueAtm[venueId]!.push({ expiry: entry.expiry, dte: entry.dte, atm: iv });
      }
    }

    const termStructure: TermStructure = computeTermStructure(surface);

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
