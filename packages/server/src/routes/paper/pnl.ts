import type { FastifyInstance } from 'fastify';
import { pnlService } from '../../trading-services.js';
import { AccountScopeError, authorizeAccountScope } from '../../user-service.js';
import { pnlToDto } from './mappers.js';

export async function paperPnlRoute(app: FastifyInstance) {
  app.get<{
    Querystring: { accountId?: string };
  }>('/paper/pnl', async (req, reply) => {
    let accountId: string;
    try {
      accountId = await authorizeAccountScope(req, req.query.accountId);
    } catch (err) {
      if (err instanceof AccountScopeError) {
        return reply.status(err.statusCode).send({ error: 'forbidden', message: err.message });
      }
      throw err;
    }
    const snap = await pnlService.snapshot(accountId);
    return pnlToDto(snap);
  });
}
