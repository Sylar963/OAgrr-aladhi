import type { PaperVenueId } from '@oggregator/protocol';
import { type Fill } from '../book/fill.js';
import type { Position } from '../book/position.js';
export interface SettlementInput {
    position: Position;
    venue: PaperVenueId;
    settlementSpotUsd: number;
    asOf: Date;
}
export declare function buildSettlementFill(input: SettlementInput): Fill | null;
//# sourceMappingURL=settle-expirations.d.ts.map