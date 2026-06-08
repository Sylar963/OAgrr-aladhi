import {
  CreatePaperTradeNoteRequestSchema,
  CreatePaperTradeRequestSchema,
  ReducePaperTradeRequestSchema,
} from '@oggregator/protocol';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { paperTradingStore } from '../../trading-services.js';
import { AccountScopeError, authorizeAccountScope } from '../../user-service.js';
import { paperEvents } from './events.js';
import { fillToDto, orderToDto } from './mappers.js';
import {
  addTradeNote,
  closeTrade,
  createTrade,
  getPaperOverview,
  getTradeDetailOrThrow,
  listTradeSummaries,
  reduceTrade,
} from './workspace.js';

/**
 * Resolve + authorize the requested account, replying 403 on a foreign account.
 * Returns null after sending the 403 so callers short-circuit.
 */
async function resolveScope(
  request: FastifyRequest<{ Querystring: { accountId?: string } }>,
  reply: FastifyReply,
): Promise<string | null> {
  try {
    return await authorizeAccountScope(request, request.query.accountId);
  } catch (err) {
    if (err instanceof AccountScopeError) {
      reply.status(err.statusCode).send({ error: 'forbidden', message: err.message });
      return null;
    }
    throw err;
  }
}

function persistenceUnavailable() {
  return { error: 'persistence_unavailable', message: 'DATABASE_URL not set' };
}

export async function paperTradesRoute(app: FastifyInstance) {
  app.get<{
    Querystring: { status?: 'open' | 'closed' | 'all'; limit?: string; accountId?: string };
  }>('/paper/trades', async (req, reply) => {
    if (!paperTradingStore.enabled) {
      return reply.status(503).send(persistenceUnavailable());
    }
    const status =
      req.query.status === 'open' || req.query.status === 'closed' || req.query.status === 'all'
        ? req.query.status
        : 'all';
    const limit = Math.min(Number(req.query.limit ?? '100') || 100, 500);
    const accountId = await resolveScope(req, reply);
    if (accountId === null) return reply;
    return { trades: await listTradeSummaries(status, limit, accountId) };
  });

  app.get<{
    Params: { tradeId: string };
    Querystring: { accountId?: string };
  }>('/paper/trades/:tradeId', async (req, reply) => {
    if (!paperTradingStore.enabled) {
      return reply.status(503).send(persistenceUnavailable());
    }
    const accountId = await resolveScope(req, reply);
    if (accountId === null) return reply;
    try {
      return await getTradeDetailOrThrow(req.params.tradeId, accountId);
    } catch (err) {
      if (err instanceof Error && err.message === 'Trade not found') {
        return reply.status(404).send({ error: 'not_found', message: err.message });
      }
      throw err;
    }
  });

  app.get<{
    Querystring: { accountId?: string };
  }>('/paper/overview', async (req, reply) => {
    if (!paperTradingStore.enabled) {
      return reply.status(503).send(persistenceUnavailable());
    }
    const accountId = await resolveScope(req, reply);
    if (accountId === null) return reply;
    return getPaperOverview(accountId);
  });

  app.post<{
    Querystring: { accountId?: string };
  }>('/paper/trades', async (req, reply) => {
    if (!paperTradingStore.enabled) {
      return reply.status(503).send(persistenceUnavailable());
    }
    const parsed = CreatePaperTradeRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    }
    const accountId = await resolveScope(req, reply);
    if (accountId === null) return reply;
    const result = await createTrade(parsed.data, accountId);
    paperEvents.emitOrder(orderToDto(result.order), result.fills.map(fillToDto));
    paperEvents.emitTrade(result.trade);
    if (result.trade.activity[0]) {
      paperEvents.emitActivity(result.trade.activity[0]);
    }
    return {
      trade: result.trade,
      order: orderToDto(result.order),
      fills: result.fills.map(fillToDto),
    };
  });

  app.post<{
    Params: { tradeId: string };
    Querystring: { accountId?: string };
  }>('/paper/trades/:tradeId/notes', async (req, reply) => {
    if (!paperTradingStore.enabled) {
      return reply.status(503).send(persistenceUnavailable());
    }
    const parsed = CreatePaperTradeNoteRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    }
    const accountId = await resolveScope(req, reply);
    if (accountId === null) return reply;
    try {
      const trade = await addTradeNote(req.params.tradeId, parsed.data, accountId);
      paperEvents.emitTrade(trade);
      if (trade.activity[0]) {
        paperEvents.emitActivity(trade.activity[0]);
      }
      return trade;
    } catch (err) {
      if (err instanceof Error && err.message === 'Trade not found') {
        return reply.status(404).send({ error: 'not_found', message: err.message });
      }
      throw err;
    }
  });

  app.post<{
    Params: { tradeId: string };
    Querystring: { accountId?: string };
  }>('/paper/trades/:tradeId/actions/close', async (req, reply) => {
    if (!paperTradingStore.enabled) {
      return reply.status(503).send(persistenceUnavailable());
    }
    const accountId = await resolveScope(req, reply);
    if (accountId === null) return reply;
    try {
      const result = await closeTrade(req.params.tradeId, accountId);
      paperEvents.emitOrder(orderToDto(result.order), result.fills.map(fillToDto));
      paperEvents.emitTrade(result.trade);
      if (result.trade.activity[0]) {
        paperEvents.emitActivity(result.trade.activity[0]);
      }
      return result.trade;
    } catch (err) {
      if (
        err instanceof Error &&
        (err.message === 'Trade not found' || err.message === 'Trade is already flat')
      ) {
        return reply.status(404).send({ error: 'not_found', message: err.message });
      }
      throw err;
    }
  });

  app.post<{
    Params: { tradeId: string };
    Querystring: { accountId?: string };
  }>('/paper/trades/:tradeId/actions/reduce', async (req, reply) => {
    if (!paperTradingStore.enabled) {
      return reply.status(503).send(persistenceUnavailable());
    }
    const parsed = ReducePaperTradeRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    }
    const accountId = await resolveScope(req, reply);
    if (accountId === null) return reply;
    try {
      const result = await reduceTrade(req.params.tradeId, parsed.data.fraction, accountId);
      paperEvents.emitOrder(orderToDto(result.order), result.fills.map(fillToDto));
      paperEvents.emitTrade(result.trade);
      if (result.trade.activity[0]) {
        paperEvents.emitActivity(result.trade.activity[0]);
      }
      return result.trade;
    } catch (err) {
      if (
        err instanceof Error &&
        (err.message === 'Trade not found' || err.message === 'Trade is already flat')
      ) {
        return reply.status(404).send({ error: 'not_found', message: err.message });
      }
      throw err;
    }
  });
}
