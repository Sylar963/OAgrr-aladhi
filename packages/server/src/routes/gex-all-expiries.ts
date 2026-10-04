import type { FastifyInstance } from 'fastify';
import { type AllExpiriesGex, getAllExpiriesGex, parseGexVenues } from '../gex-all-expiries.js';

export type AllExpiriesGexResponse = AllExpiriesGex;

export async function gexAllExpiriesRoute(app: FastifyInstance) {
  app.get<{ Querystring: { underlying: string; venues?: string } }>(
    '/gex-all-expiries',
    async (req, reply): Promise<AllExpiriesGexResponse | { error: string }> => {
      const { underlying, venues: venuesParam } = req.query;
      if (!underlying) {
        return reply.status(400).send({ error: 'underlying query param required' });
      }
      return getAllExpiriesGex(underlying, parseGexVenues(venuesParam));
    },
  );
}
