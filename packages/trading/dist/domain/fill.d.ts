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
export declare function newFillId(): FillId;
export declare function fillCashDelta(fill: Fill): UsdAmount;
//# sourceMappingURL=fill.d.ts.map