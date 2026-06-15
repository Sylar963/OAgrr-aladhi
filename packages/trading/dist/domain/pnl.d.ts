import type { UsdAmount } from './money.js';
import type { Position } from './position.js';
export interface PositionMark {
    key: Position['key'];
    markPriceUsd: number | null;
}
export interface PositionPnl {
    key: Position['key'];
    netQuantity: number;
    avgEntryPriceUsd: UsdAmount;
    markPriceUsd: number | null;
    unrealizedUsd: UsdAmount | null;
    realizedUsd: UsdAmount;
}
export interface PnlSnapshot {
    positions: PositionPnl[];
    cashUsd: UsdAmount;
    realizedUsd: UsdAmount;
    unrealizedUsd: UsdAmount;
    equityUsd: UsdAmount;
    generatedAt: Date;
}
export declare function computePositionPnl(pos: Position, mark: number | null): PositionPnl;
export declare function computeSnapshot(positions: Position[], marks: Map<string, number | null>, cashUsd: UsdAmount, now: Date): PnlSnapshot;
//# sourceMappingURL=pnl.d.ts.map