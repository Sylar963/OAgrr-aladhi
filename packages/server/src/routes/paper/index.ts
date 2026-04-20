import type { FastifyInstance } from 'fastify';
import { paperActivityRoute } from './activity.js';
import { paperFillsRoute } from './fills.js';
import { paperOrdersRoute } from './orders.js';
import { paperPositionsRoute } from './positions.js';
import { paperPnlRoute } from './pnl.js';
import { paperTradesRoute } from './trades.js';
import { paperWsRoute } from './ws.js';

export async function paperRoutes(app: FastifyInstance) {
  await paperOrdersRoute(app);
  await paperPositionsRoute(app);
  await paperPnlRoute(app);
  await paperTradesRoute(app);
  await paperActivityRoute(app);
  await paperFillsRoute(app);
}

export { paperWsRoute };
