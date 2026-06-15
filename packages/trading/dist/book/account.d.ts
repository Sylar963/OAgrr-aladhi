import type { UsdAmount } from './money.js';
export type AccountId = string;
export interface Account {
    id: AccountId;
    label: string;
    initialCashUsd: UsdAmount;
    createdAt: Date;
}
export declare const DEFAULT_ACCOUNT_ID: AccountId;
export declare const DEFAULT_ACCOUNT_LABEL = "Paper (default)";
export declare const DEFAULT_INITIAL_CASH_USD: UsdAmount;
//# sourceMappingURL=account.d.ts.map