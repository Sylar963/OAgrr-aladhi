import type { PaperVenueId } from '@oggregator/protocol';
import type { AccountId } from '../book/account.js';
import { type Fill } from '../book/fill.js';
import { type Order, type OrderLeg } from '../book/order.js';
import type { Clock } from '../gateways/clock.js';
import type { FillEngine } from '../gateways/fill-engine.js';
import type { OrderRepository } from '../gateways/order-repository.js';
import type { PositionRepository } from '../gateways/position-repository.js';
import type { MarginEngine } from '../risk/margin-engine.js';
import type { PnlService } from './compute-pnl.js';
export interface PlaceOrderInput {
    accountId: AccountId;
    clientOrderId?: string;
    legs: Array<Omit<OrderLeg, 'index'>>;
    venueFilter: PaperVenueId[];
}
export interface PlaceOrderResult {
    order: Order;
    fills: Fill[];
}
export interface OrderPlacementServiceOptions {
    marginEngine?: MarginEngine;
    pnlService?: PnlService;
}
export declare class OrderPlacementService {
    private readonly orders;
    private readonly positions;
    private readonly fillEngine;
    private readonly clock;
    private readonly marginEngine;
    private readonly pnlService;
    constructor(orders: OrderRepository, positions: PositionRepository, fillEngine: FillEngine, clock: Clock, options?: OrderPlacementServiceOptions);
    place(input: PlaceOrderInput): Promise<PlaceOrderResult>;
    private checkMargin;
    private equityFor;
}
//# sourceMappingURL=place-order.d.ts.map