import type { UsdAmount } from './money.js';
import type { Fill } from './fill.js';
import type { OptionRight } from './order.js';
export interface PositionKey {
    accountId: string;
    underlying: string;
    expiry: string;
    strike: number;
    optionRight: OptionRight;
}
export interface Position {
    key: PositionKey;
    netQuantity: number;
    avgEntryPriceUsd: UsdAmount;
    realizedPnlUsd: UsdAmount;
    openedAt: Date;
    lastFillAt: Date;
}
export declare function positionKeyId(key: PositionKey): string;
export declare function keyFromFill(accountId: string, fill: Fill): PositionKey;
/**
 * Fold a fill into a prior position, returning the new state.
 * Realized PnL accrues only on quantity closed (opposite side of the prior net).
 */
export declare function applyFillToPosition(prior: Position | null, fill: Fill): Position;
//# sourceMappingURL=position.d.ts.map