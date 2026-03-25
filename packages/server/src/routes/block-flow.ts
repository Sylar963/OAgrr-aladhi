import type { FastifyInstance } from 'fastify';
import type { BlockTradeEvent } from '@oggregator/core';
import { blockFlowService, isBlockFlowReady, spotService } from '../services.js';

interface EnrichedBlockTradeEvent extends BlockTradeEvent {
  premiumUsd: number | null;
  referencePriceUsd: number | null;
}

export async function blockFlowRoute(app: FastifyInstance) {
  app.get<{
    Querystring: { underlying?: string; limit?: string };
  }>('/block-flow', async (req, reply) => {
    if (!isBlockFlowReady()) {
      return reply.status(503).send({ error: 'block flow service not available' });
    }

    const underlying = req.query.underlying;
    const rawLimit = Number(req.query.limit);
    const limit = Math.min(
      Number.isFinite(rawLimit) && rawLimit > 0 ? Math.floor(rawLimit) : 100,
      300,
    );

    const trades = blockFlowService.getTrades(underlying);
    const enriched = trades.slice(0, limit).map((trade) => enrichTrade(trade));

    return {
      count: trades.length,
      trades: enriched,
    };
  });
}

function enrichTrade(trade: BlockTradeEvent): EnrichedBlockTradeEvent {
  const referencePriceUsd = trade.indexPrice ?? getSpotPriceUsd(trade.underlying);
  const contractMultiplier = getContractMultiplier(trade.venue, trade.underlying);

  const premiumUsd = trade.legs.reduce<number | null>((sum, leg) => {
    const isInversePrice = leg.price > 0 && leg.price < 1;
    if (isInversePrice && (referencePriceUsd == null || referencePriceUsd <= 0)) return null;
    const legPriceUsd = isInversePrice ? leg.price * referencePriceUsd! : leg.price;
    return (sum ?? 0) + legPriceUsd * leg.size * leg.ratio * contractMultiplier;
  }, 0);

  const notionalUsd = referencePriceUsd != null && referencePriceUsd > 0
    ? trade.legs.reduce(
      (sum, leg) => sum + (leg.size * leg.ratio * contractMultiplier * referencePriceUsd),
      0,
    )
    : 0;

  return {
    ...trade,
    premiumUsd,
    notionalUsd,
    referencePriceUsd: referencePriceUsd ?? null,
  };
}

function getSpotPriceUsd(underlying: string): number | null {
  const snapshot = spotService.getSnapshot(underlying.toUpperCase());
  return snapshot?.lastPrice ?? null;
}

function getContractMultiplier(venue: BlockTradeEvent['venue'], underlying: string): number {
  if (venue !== 'okx') return 1;
  const upper = underlying.toUpperCase();
  if (upper === 'BTC') return 0.01;
  if (upper === 'ETH') return 0.1;
  return 1;
}
