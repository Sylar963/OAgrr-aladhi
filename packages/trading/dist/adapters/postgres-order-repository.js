export class PostgresOrderRepository {
    store;
    constructor(store) {
        this.store = store;
    }
    async saveOrder(order) {
        await this.store.insertOrder(toOrderRow(order));
    }
    async updateOrderStatus(order) {
        await this.store.updateOrder(toOrderRow(order));
    }
    async saveFills(fills) {
        await this.store.insertFills(fills.map(toFillRow));
    }
    async getOrder(id) {
        const row = await this.store.getOrder(id);
        return row ? fromOrderRow(row) : null;
    }
    async listOrders(accountId, limit) {
        const rows = await this.store.listOrders(accountId, limit);
        return rows.map(fromOrderRow);
    }
    async listFills(accountId, limit) {
        const rows = await this.store.listFills(accountId, limit);
        return rows.map(fromFillRow);
    }
}
function toOrderRow(order) {
    return {
        id: order.id,
        clientOrderId: order.clientOrderId,
        accountId: order.accountId,
        mode: order.mode,
        kind: order.kind,
        status: order.status,
        legs: order.legs,
        submittedAt: order.submittedAt,
        filledAt: order.filledAt,
        rejectionReason: order.rejectionReason,
        totalDebitUsd: order.totalDebitUsd,
    };
}
function fromOrderRow(row) {
    return {
        id: row.id,
        clientOrderId: row.clientOrderId,
        accountId: row.accountId,
        mode: row.mode,
        kind: row.kind,
        status: row.status,
        legs: row.legs ?? [],
        submittedAt: row.submittedAt,
        filledAt: row.filledAt,
        rejectionReason: row.rejectionReason,
        totalDebitUsd: row.totalDebitUsd,
    };
}
function toFillRow(fill) {
    return {
        id: fill.id,
        orderId: fill.orderId,
        legIndex: fill.legIndex,
        venue: fill.venue,
        side: fill.side,
        optionRight: fill.optionRight,
        underlying: fill.underlying,
        expiry: fill.expiry,
        strike: fill.strike,
        quantity: fill.quantity,
        requestedQuantity: fill.requestedQuantity,
        priceUsd: fill.priceUsd,
        feesUsd: fill.feesUsd,
        slippageUsd: fill.slippageUsd,
        partialFill: fill.partialFill,
        benchmarkBidUsd: fill.benchmarkBidUsd,
        benchmarkAskUsd: fill.benchmarkAskUsd,
        benchmarkMidUsd: fill.benchmarkMidUsd,
        underlyingSpotUsd: fill.underlyingSpotUsd,
        source: fill.source,
        filledAt: fill.filledAt,
    };
}
function fromFillRow(row) {
    return {
        id: row.id,
        orderId: row.orderId,
        legIndex: row.legIndex,
        venue: row.venue,
        side: row.side,
        optionRight: row.optionRight,
        underlying: row.underlying,
        expiry: row.expiry,
        strike: row.strike,
        quantity: row.quantity,
        requestedQuantity: row.requestedQuantity,
        priceUsd: row.priceUsd,
        feesUsd: row.feesUsd,
        slippageUsd: row.slippageUsd,
        partialFill: row.partialFill,
        benchmarkBidUsd: row.benchmarkBidUsd,
        benchmarkAskUsd: row.benchmarkAskUsd,
        benchmarkMidUsd: row.benchmarkMidUsd,
        underlyingSpotUsd: row.underlyingSpotUsd,
        source: row.source,
        filledAt: row.filledAt,
    };
}
//# sourceMappingURL=postgres-order-repository.js.map