import type { AccountId } from '../domain/account.js';
import type { UsdAmount } from '../domain/money.js';
import type { Position } from '../domain/position.js';
export interface CashLedgerEntry {
    accountId: AccountId;
    deltaUsd: UsdAmount;
    reason: 'fill' | 'fee' | 'init' | 'adjustment';
    refId: string | null;
    ts: Date;
}
export interface PositionRepository {
    listPositions(accountId: AccountId): Promise<Position[]>;
    upsertPosition(pos: Position): Promise<void>;
    appendCashLedger(entry: CashLedgerEntry): Promise<void>;
    getCashBalance(accountId: AccountId): Promise<UsdAmount>;
    ensureAccount(accountId: AccountId, label: string, initialCashUsd: UsdAmount): Promise<void>;
}
//# sourceMappingURL=position-repository.d.ts.map