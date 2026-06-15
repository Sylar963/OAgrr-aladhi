import type { PaperTradingStore } from '@oggregator/db';
import type { AccountId } from '../domain/account.js';
import type { Position } from '../domain/position.js';
import type { CashLedgerEntry, PositionRepository } from '../ports/position-repository.js';
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