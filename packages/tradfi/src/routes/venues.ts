import type { FastifyInstance } from 'fastify';

export async function venuesRoute(app: FastifyInstance) {
  app.get('/venues', async () => [
    { venue: 'tastytrade', capabilities: { optionChain: true, greeks: true, websocket: true } },
  ]);
}
