import type { FastifyInstance } from 'fastify';
import { paperOrdersRoute } from './orders.js';
import { paperPositionsRoute } from './positions.js';
import { paperPnlRoute } from './pnl.js';
import { paperWsRoute } from './ws.js';

export async function paperRoutes(app: FastifyInstance) {
  await paperOrdersRoute(app);
  await paperPositionsRoute(app);
  await paperPnlRoute(app);
}

export { paperWsRoute };
