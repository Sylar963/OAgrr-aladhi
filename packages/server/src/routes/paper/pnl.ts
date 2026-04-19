import type { FastifyInstance } from 'fastify';
import { DEFAULT_ACCOUNT_ID, pnlService } from '../../trading-services.js';
import { pnlToDto } from './mappers.js';

export async function paperPnlRoute(app: FastifyInstance) {
  app.get('/paper/pnl', async () => {
    const snap = await pnlService.snapshot(DEFAULT_ACCOUNT_ID);
    return pnlToDto(snap);
  });
}
