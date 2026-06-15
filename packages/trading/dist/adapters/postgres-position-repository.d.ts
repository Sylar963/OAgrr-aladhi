import type { PaperTradingStore } from '@oggregator/db';
import type { AccountId } from '../book/account.js';
import type { Position } from '../book/position.js';
import type { CashLedgerEntry, PositionRepository } from '../gateways/position-repository.js';
export declare class PostgresPositionRepository implements PositionRepository {
    private readonly store;
    constructor(store: PaperTradingStore);
    listPositions(accountId: AccountId): Promise<Position[]>;
    upsertPosition(pos: Position): Promise<void>;
    appendCashLedger(entry: CashLedgerEntry): Promise<void>;
    getCashBalance(accountId: AccountId): Promise<number>;
    ensureAccount(accountId: AccountId, label: string, initialCashUsd: number): Promise<void>;
}
//# sourceMappingURL=postgres-position-repository.d.ts.map