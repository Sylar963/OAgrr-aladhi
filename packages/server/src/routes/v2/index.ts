import type { FastifyInstance } from 'fastify';
import { v2VenuesRoute } from './venues.js';
import { v2UnderlyingsRoute } from './underlyings.js';
import { v2ExpiriesRoute } from './expiries.js';
import { v2ChainsRoute } from './chains.js';
import { v2WsChainRoute } from './ws-chain.js';

export async function v2Routes(app: FastifyInstance) {
  await app.register(v2VenuesRoute);
  await app.register(v2UnderlyingsRoute);
  await app.register(v2ExpiriesRoute);
  await app.register(v2ChainsRoute);
}

export { v2WsChainRoute };
