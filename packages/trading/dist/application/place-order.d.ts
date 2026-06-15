import type { VenueId } from '@oggregator/core';
import type { AccountId } from '../domain/account.js';
import { type Fill } from '../domain/fill.js';
import { type Order, type OrderLeg } from '../domain/order.js';
import type { Clock } from '../ports/clock.js';
import type { FillEngine } from '../ports/fill-engine.js';
import type { OrderRepository } from '../ports/order-repository.js';
import type { PositionRepository } from '../ports/position-repository.js';
export interface PlaceOrderInput {
    accountId: AccountId;
    clientOrderId?: string;
    legs: Array<Omit<OrderLeg, 'index'>>;
    venueFilter: VenueId[];
}
export interface PlaceOrderResult {
    order: Order;
    fills: Fill[];
}
export declare class OrderPlacementService {
    private readonly orders;
    private readonly positions;
    private readonly fillEngine;
    private readonly clock;
    constructor(orders: OrderRepository, positions: PositionRepository, fillEngine: FillEngine, clock: Clock);
    place(input: PlaceOrderInput): Promise<PlaceOrderResult>;
}
//# sourceMappingURL=place-order.d.ts.map