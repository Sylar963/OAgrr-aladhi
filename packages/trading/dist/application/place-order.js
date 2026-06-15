import { InvalidOrderError, NoLiquidityError, TradingError } from '../domain/errors.js';
import { fillCashDelta } from '../domain/fill.js';
import { newClientOrderId, newOrderId, } from '../domain/order.js';
import { applyFill } from './apply-fill.js';
export class OrderPlacementService {
    orders;
    positions;
    fillEngine;
    clock;
    constructor(orders, positions, fillEngine, clock) {
        this.orders = orders;
        this.positions = positions;
        this.fillEngine = fillEngine;
        this.clock = clock;
    }
    async place(input) {
        if (input.legs.length === 0) {
            throw new InvalidOrderError('Order must have at least one leg');
        }
        input.legs.forEach((leg, idx) => {
            if (leg.quantity <= 0) {
                throw new InvalidOrderError(`Leg quantity must be positive (leg ${idx})`);
            }
        });
        const now = this.clock.now();
        const legs = input.legs.map((leg, index) => ({ ...leg, index }));
        const order = {
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
        let fills;
        try {
            fills = await this.fillEngine.executeOrder(order, input.venueFilter);
        }
        catch (err) {
            const reason = err instanceof TradingError ? err.message : 'Fill failed';
            const rejected = {
                ...order,
                status: 'rejected',
                rejectionReason: reason,
            };
            await this.orders.updateOrderStatus(rejected);
            if (err instanceof NoLiquidityError)
                throw err;
            throw new TradingError(reason, 'FILL_FAILED');
        }
        await this.orders.saveFills(fills);
        for (const fill of fills) {
            await applyFill(this.positions, input.accountId, fill);
        }
        const totalCash = fills.reduce((sum, f) => sum + fillCashDelta(f), 0);
        const filled = {
            ...order,
            status: 'filled',
            filledAt: this.clock.now(),
            totalDebitUsd: -totalCash,
        };
        await this.orders.updateOrderStatus(filled);
        return { order: filled, fills };
    }
}
//# sourceMappingURL=place-order.js.map