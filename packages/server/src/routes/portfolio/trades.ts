import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { DEFAULT_ACCOUNT_ID } from '@oggregator/trading';
import {
  ExchangePortfolioVenueSchema,
  type ExchangeTradesResponse,
} from '@oggregator/protocol';

import { exchangePortfolioLedgerStore } from '../../trading-services.js';
import { getRequestAccountId } from '../../user-service.js';

const ExchangeTradesQuerySchema = z.object({
  venue: z.string(),
  underlying: z.string().trim().min(1).optional(),
  expiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  strike: z.coerce.number().positive().optional(),
  right: z.enum(['call', 'put']).optional(),
});

const LEDGER_LOAD_LIMIT = 5_000;

export async function portfolioTradesRoute(app: FastifyInstance) {
  app.get('/portfolio/exchange-trades', async (req, reply) => {
    const parsed = ExchangeTradesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid_query', issues: parsed.error.issues });
    }
    const venueParsed = ExchangePortfolioVenueSchema.safeParse(parsed.data.venue);
    if (!venueParsed.success) {
      return reply.status(400).send({ error: 'invalid_venue' });
    }
    const venue = venueParsed.data;
    const { underlying, expiry, strike, right } = parsed.data;
    const accountId = getRequestAccountId(req, DEFAULT_ACCOUNT_ID);

    if (!exchangePortfolioLedgerStore.enabled) {
      const empty: ExchangeTradesResponse = { accountId, venue, ledgerEnabled: false, trades: [] };
      return empty;
    }

    const rows = await exchangePortfolioLedgerStore.loadTrades(accountId, venue, LEDGER_LOAD_LIMIT);
    const trades = rows
      .filter(
        (row) =>
          (underlying == null || row.underlying === underlying) &&
          (expiry == null || row.expiry === expiry) &&
          (strike == null || row.strike === strike) &&
          (right == null || row.optionRight === right),
      )
      .map((row) => ({ ...row, venue }));
    const response: ExchangeTradesResponse = { accountId, venue, ledgerEnabled: true, trades };
    return response;
  });
}
