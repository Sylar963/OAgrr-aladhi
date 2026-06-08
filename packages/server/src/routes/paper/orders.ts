import { PlaceOrderRequestSchema } from '@oggregator/protocol';
import type { OrderLeg } from '@oggregator/trading';
import {
  InsufficientMarginError,
  InvalidOrderError,
  MarginCheckUnavailableError,
  NoLiquidityError,
  TradingError,
} from '@oggregator/trading';
import type { FastifyInstance } from 'fastify';
import {
  ensureDefaultAccount,
  orderPlacementService,
  orderRepository,
  paperTradingStore,
} from '../../trading-services.js';
import { paperEvents } from './events.js';
import { fillToDto, orderToDto } from './mappers.js';
import { resolveScope } from './scope.js';

export async function paperOrdersRoute(app: FastifyInstance) {
  app.post<{
    Body: unknown;
  }>('/paper/orders', async (req, reply) => {
    if (!paperTradingStore.enabled) {
      return reply
        .status(503)
        .send({ error: 'persistence_unavailable', message: 'DATABASE_URL not set' });
    }

    const parsed = PlaceOrderRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    }

    const accountId = await resolveScope(req, reply);
    if (accountId === null) return reply;
    await ensureDefaultAccount();

    try {
      const legs: Array<Omit<OrderLeg, 'index'>> = parsed.data.legs.map((leg) => ({
        side: leg.side,
        optionRight: leg.optionRight,
        underlying: leg.underlying,
        expiry: leg.expiry,
        strike: leg.strike,
        quantity: leg.quantity,
        preferredVenues: leg.preferredVenues ?? null,
      }));
      const result = await orderPlacementService.place({
        accountId,
        legs,
        venueFilter: parsed.data.venueFilter,
        ...(parsed.data.clientOrderId ? { clientOrderId: parsed.data.clientOrderId } : {}),
      });

      const orderDto = orderToDto(result.order);
      const fillsDto = result.fills.map(fillToDto);
      paperEvents.emitOrder(orderDto, fillsDto);

      return { order: orderDto, fills: fillsDto };
    } catch (err) {
      if (err instanceof NoLiquidityError) {
        return reply.status(422).send({
          error: 'no_liquidity',
          message: err.message,
          legIndex: err.legIndex,
        });
      }
      if (err instanceof InsufficientMarginError) {
        return reply.status(422).send({
          error: 'insufficient_margin',
          message: err.message,
          requiredUsd: err.requiredUsd,
          availableUsd: err.availableUsd,
          bufferUsd: err.bufferUsd,
        });
      }
      if (err instanceof MarginCheckUnavailableError) {
        return reply.status(422).send({
          error: 'margin_check_unavailable',
          message: err.message,
          legIndex: err.legIndex,
          reason: err.reason,
        });
      }
      if (err instanceof InvalidOrderError) {
        return reply.status(400).send({ error: 'invalid_order', message: err.message });
      }
      if (err instanceof TradingError) {
        return reply.status(500).send({ error: err.code, message: err.message });
      }
      throw err;
    }
  });

  app.get<{
    Querystring: { limit?: string };
  }>('/paper/orders', async (req, reply) => {
    const accountId = await resolveScope(req, reply);
    if (accountId === null) return reply;
    const limit = Math.min(Number(req.query.limit ?? '50') || 50, 500);
    const orders = await orderRepository.listOrders(accountId, limit);
    return { orders: orders.map(orderToDto) };
  });
}
