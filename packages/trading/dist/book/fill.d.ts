import type { PaperVenueId } from '@oggregator/protocol';
import type { UsdAmount } from './money.js';
import type { OptionRight, OrderId, OrderSide } from './order.js';
export type FillId = string;
export type FillSource = 'paper' | 'live' | 'settlement';
export interface Fill {
    id: FillId;
    orderId: OrderId;
    legIndex: number;
    venue: PaperVenueId;
    side: OrderSide;
    optionRight: OptionRight;
    underlying: string;
    expiry: string;
    strike: number;
    quantity: number;
    requestedQuantity: number;
    priceUsd: UsdAmount;
    feesUsd: UsdAmount;
    slippageUsd: UsdAmount;
    partialFill: boolean;
    benchmarkBidUsd: UsdAmount | null;
    benchmarkAskUsd: UsdAmount | null;
    benchmarkMidUsd: UsdAmount | null;
    underlyingSpotUsd: UsdAmount | null;
    source: FillSource;
    filledAt: Date;
}
export declare function newFillId(): FillId;
export declare function fillCashDelta(fill: Fill): UsdAmount;
//# sourceMappingURL=fill.d.ts.map