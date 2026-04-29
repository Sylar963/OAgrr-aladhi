import type { FastifyInstance } from 'fastify';
import type { OptionVenueAdapter } from '@oggregator/core';
import { getAdaptersByAssetClass } from '../../asset-class.js';

export async function v2VenuesRoute(app: FastifyInstance) {
  app.get('/v2/venues', async () => {
    const adapters = getAdaptersByAssetClass('tradfi');
    return adapters.map((a: OptionVenueAdapter) => ({
      venue: a.venue,
      capabilities: a.capabilities,
    }));
  });
}
