import type { PaperTradingStore } from '@oggregator/db';
import type { AccountId } from '../book/account.js';
import type { Fill } from '../book/fill.js';
import type { Order } from '../book/order.js';
import type { OrderRepository } from '../gateways/order-repository.js';
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