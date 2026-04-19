import type {
  PaperFillDto,
  PaperOrderDto,
  PaperPnlDto,
  PaperPositionDto,
} from '@oggregator/protocol';
import type { Fill, Order, PnlSnapshot, Position } from '@oggregator/trading';

export function orderToDto(order: Order): PaperOrderDto {
  return {
    id: order.id,
    clientOrderId: order.clientOrderId,
    accountId: order.accountId,
    status: order.status,
    legs: order.legs.map((l) => ({ ...l })),
    submittedAt: order.submittedAt.toISOString(),
    filledAt: order.filledAt ? order.filledAt.toISOString() : null,
    rejectionReason: order.rejectionReason,
    totalDebitUsd: order.totalDebitUsd,
  };
}

export function fillToDto(fill: Fill): PaperFillDto {
  return {
    id: fill.id,
    orderId: fill.orderId,
    legIndex: fill.legIndex,
    venue: fill.venue,
    side: fill.side,
    optionRight: fill.optionRight,
    underlying: fill.underlying,
    expiry: fill.expiry,
    strike: fill.strike,
    quantity: fill.quantity,
    priceUsd: fill.priceUsd,
    feesUsd: fill.feesUsd,
    filledAt: fill.filledAt.toISOString(),
  };
}

export function positionToDto(
  pos: Position,
  markPriceUsd: number | null,
): PaperPositionDto {
  const unrealized =
    markPriceUsd != null
      ? pos.netQuantity * (markPriceUsd - pos.avgEntryPriceUsd)
      : null;
  return {
    underlying: pos.key.underlying,
    expiry: pos.key.expiry,
    strike: pos.key.strike,
    optionRight: pos.key.optionRight,
    netQuantity: pos.netQuantity,
    avgEntryPriceUsd: pos.avgEntryPriceUsd,
    realizedPnlUsd: pos.realizedPnlUsd,
    markPriceUsd,
    unrealizedPnlUsd: unrealized,
    openedAt: pos.openedAt.toISOString(),
    lastFillAt: pos.lastFillAt.toISOString(),
  };
}

export function pnlToDto(snap: PnlSnapshot): PaperPnlDto {
  return {
    cashUsd: snap.cashUsd,
    realizedUsd: snap.realizedUsd,
    unrealizedUsd: snap.unrealizedUsd,
    equityUsd: snap.equityUsd,
    generatedAt: snap.generatedAt.toISOString(),
  };
}
