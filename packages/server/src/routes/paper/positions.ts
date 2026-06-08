import type { FastifyInstance } from 'fastify';
import { positionRepository, quoteProvider } from '../../trading-services.js';
import { AccountScopeError, authorizeAccountScope } from '../../user-service.js';
import { positionToDto } from './mappers.js';

export async function paperPositionsRoute(app: FastifyInstance) {
  app.get<{
    Querystring: { accountId?: string };
  }>('/paper/positions', async (req, reply) => {
    let accountId: string;
    try {
      accountId = await authorizeAccountScope(req, req.query.accountId);
    } catch (err) {
      if (err instanceof AccountScopeError) {
        return reply.status(err.statusCode).send({ error: 'forbidden', message: err.message });
      }
      throw err;
    }
    const positions = await positionRepository.listPositions(accountId);
    const open = positions.filter((p) => p.netQuantity !== 0);
    const marks = await Promise.all(
      open.map(async (p) =>
        quoteProvider.getMark({
          underlying: p.key.underlying,
          expiry: p.key.expiry,
          strike: p.key.strike,
          optionRight: p.key.optionRight,
        }),
      ),
    );
    return {
      positions: open.map((pos, idx) => positionToDto(pos, marks[idx] ?? null)),
    };
  });
}
