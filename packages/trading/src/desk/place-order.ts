import type { VenueId } from '@oggregator/core';
import type { AccountId } from '../book/account.js';
import { InvalidOrderError, NoLiquidityError, TradingError } from '../book/errors.js';
import { fillCashDelta, type Fill } from '../book/fill.js';
import {
  newClientOrderId,
  newOrderId,
  type Order,
  type OrderLeg,
} from '../book/order.js';
import type { Clock } from '../gateways/clock.js';
import type { FillEngine } from '../gateways/fill-engine.js';
import type { OrderRepository } from '../gateways/order-repository.js';
import type { PositionRepository } from '../gateways/position-repository.js';
import { applyFill } from './apply-fill.js';

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

export class OrderPlacementService {
  constructor(
    private readonly orders: OrderRepository,
    private readonly positions: PositionRepository,
    private readonly fillEngine: FillEngine,
    private readonly clock: Clock,
  ) {}

  async place(input: PlaceOrderInput): Promise<PlaceOrderResult> {
    if (input.legs.length === 0) {
      throw new InvalidOrderError('Order must have at least one leg');
    }
    input.legs.forEach((leg, idx) => {
      if (leg.quantity <= 0) {
        throw new InvalidOrderError(`Leg quantity must be positive (leg ${idx})`);
      }
    });

    const now = this.clock.now();
    const legs: OrderLeg[] = input.legs.map((leg, index) => ({ ...leg, index }));
    const order: Order = {
      id: newOrderId(),
      clientOrderId: input.clientOrderId ?? newClientOrderId(),
      accountId: input.accountId,
      mode: 'paper',
      kind: 'market',
      status: 'accepted',
      legs,
      submittedAt: now,
      filledAt: null,
      rejectionReason: null,
      totalDebitUsd: null,
    };

    await this.orders.saveOrder(order);

    let fills: Fill[];
    try {
      fills = await this.fillEngine.executeOrder(order, input.venueFilter);
    } catch (err) {
      const reason = err instanceof TradingError ? err.message : 'Fill failed';
      const rejected: Order = {
        ...order,
        status: 'rejected',
        rejectionReason: reason,
      };
      await this.orders.updateOrderStatus(rejected);
      if (err instanceof NoLiquidityError) throw err;
      throw new TradingError(reason, 'FILL_FAILED');
    }

    await this.orders.saveFills(fills);
    for (const fill of fills) {
      await applyFill(this.positions, input.accountId, fill);
    }

    const totalCash = fills.reduce((sum, f) => sum + fillCashDelta(f), 0);
    const filled: Order = {
      ...order,
      status: 'filled',
      filledAt: this.clock.now(),
      totalDebitUsd: -totalCash,
    };
    await this.orders.updateOrderStatus(filled);

    return { order: filled, fills };
  }
}
