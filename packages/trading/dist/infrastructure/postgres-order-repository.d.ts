import type { PaperTradingStore } from '@oggregator/db';
import type { AccountId } from '../domain/account.js';
import type { Fill } from '../domain/fill.js';
import type { Order } from '../domain/order.js';
import type { OrderRepository } from '../ports/order-repository.js';
export declare class PostgresOrderRepository implements OrderRepository {
    private readonly store;
    constructor(store: PaperTradingStore);
    saveOrder(order: Order): Promise<void>;
    updateOrderStatus(order: Order): Promise<void>;
    saveFills(fills: Fill[]): Promise<void>;
    getOrder(id: string): Promise<Order | null>;
    listOrders(accountId: AccountId, limit: number): Promise<Order[]>;
    listFills(accountId: AccountId, limit: number): Promise<Fill[]>;
}
//# sourceMappingURL=postgres-order-repository.d.ts.map