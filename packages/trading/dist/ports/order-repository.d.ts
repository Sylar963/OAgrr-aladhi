import type { Order, OrderId } from '../domain/order.js';
import type { Fill } from '../domain/fill.js';
import type { AccountId } from '../domain/account.js';
export interface OrderRepository {
    saveOrder(order: Order): Promise<void>;
    updateOrderStatus(order: Order): Promise<void>;
    saveFills(fills: Fill[]): Promise<void>;
    getOrder(id: OrderId): Promise<Order | null>;
    listOrders(accountId: AccountId, limit: number): Promise<Order[]>;
    listFills(accountId: AccountId, limit: number): Promise<Fill[]>;
}
//# sourceMappingURL=order-repository.d.ts.map