import type { FastifyInstance } from 'fastify';
import { pnlService } from '../../trading-services.js';
import { pnlToDto } from './mappers.js';
import { resolveScope } from './scope.js';

export async function paperPnlRoute(app: FastifyInstance) {
  app.get('/paper/pnl', async (req, reply) => {
    const accountId = await resolveScope(req, reply);
    if (accountId === null) return reply;
    const snap = await pnlService.snapshot(accountId);
    return pnlToDto(snap);
  });
}
