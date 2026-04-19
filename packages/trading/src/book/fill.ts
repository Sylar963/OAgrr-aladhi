import type { VenueId } from '@oggregator/core';
import type { UsdAmount } from './money.js';
import type { OptionRight, OrderId, OrderSide } from './order.js';

export type FillId = string;
export type FillSource = 'paper' | 'live';

export interface Fill {
  id: FillId;
  orderId: OrderId;
  legIndex: number;
  venue: VenueId;
  side: OrderSide;
  optionRight: OptionRight;
  underlying: string;
  expiry: string;
  strike: number;
  quantity: number;
  priceUsd: UsdAmount;
  feesUsd: UsdAmount;
  source: FillSource;
  filledAt: Date;
}

export function newFillId(): FillId {
  const bytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `fil_${hex}`;
}

export function fillCashDelta(fill: Fill): UsdAmount {
  const sign = fill.side === 'buy' ? -1 : 1;
  const premium = sign * fill.priceUsd * fill.quantity;
  return premium - fill.feesUsd;
}
