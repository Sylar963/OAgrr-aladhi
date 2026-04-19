import type { FastifyInstance } from 'fastify';
import {
  DEFAULT_ACCOUNT_ID,
  positionRepository,
  quoteProvider,
} from '../../trading-services.js';
import { positionToDto } from './mappers.js';

export async function paperPositionsRoute(app: FastifyInstance) {
  app.get('/paper/positions', async () => {
    const positions = await positionRepository.listPositions(DEFAULT_ACCOUNT_ID);
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
