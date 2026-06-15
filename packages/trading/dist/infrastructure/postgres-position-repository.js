export class PostgresPositionRepository {
    store;
    constructor(store) {
        this.store = store;
    }
    async listPositions(accountId) {
        const rows = await this.store.listPositions(accountId);
        return rows.map(fromRow);
    }
    async upsertPosition(pos) {
        await this.store.upsertPosition(toRow(pos));
    }
    async appendCashLedger(entry) {
        await this.store.appendCashLedger({
            accountId: entry.accountId,
            deltaUsd: entry.deltaUsd,
            reason: entry.reason,
            refId: entry.refId,
            ts: entry.ts,
        });
    }
    async getCashBalance(accountId) {
        return this.store.sumCashLedger(accountId);
    }
    async ensureAccount(accountId, label, initialCashUsd) {
        await this.store.ensureAccount({
            id: accountId,
            label,
            initialCashUsd,
            createdAt: new Date(),
        });
    }
}
function toRow(pos) {
    return {
        accountId: pos.key.accountId,
        underlying: pos.key.underlying,
        expiry: pos.key.expiry,
        strike: pos.key.strike,
        optionRight: pos.key.optionRight,
        netQuantity: pos.netQuantity,
        avgEntryPriceUsd: pos.avgEntryPriceUsd,
        realizedPnlUsd: pos.realizedPnlUsd,
        openedAt: pos.openedAt,
        lastFillAt: pos.lastFillAt,
    };
}
function fromRow(row) {
    return {
        key: {
            accountId: row.accountId,
            underlying: row.underlying,
            expiry: row.expiry,
            strike: row.strike,
            optionRight: row.optionRight,
        },
        netQuantity: row.netQuantity,
        avgEntryPriceUsd: row.avgEntryPriceUsd,
        realizedPnlUsd: row.realizedPnlUsd,
        openedAt: row.openedAt,
        lastFillAt: row.lastFillAt,
    };
}
//# sourceMappingURL=postgres-position-repository.js.map