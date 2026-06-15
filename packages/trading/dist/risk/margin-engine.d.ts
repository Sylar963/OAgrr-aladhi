import type { PaperVenueId } from '@oggregator/protocol';
import type { UsdAmount } from '../book/money.js';
import type { OptionRight, OrderSide } from '../book/order.js';
import type { Position } from '../book/position.js';
export interface MarginEstimateLeg {
    index: number;
    side: OrderSide;
    optionRight: OptionRight;
    underlying: string;
    expiry: string;
    strike: number;
    quantity: number;
    preferredVenues: PaperVenueId[] | null;
}
export interface MarginPerLegBreakdown {
    legIndex: number;
    requiredUsd: UsdAmount;
    reason: string;
}
export interface MarginEstimateInput {
    prospectiveLegs: MarginEstimateLeg[];
    existingPositions: Position[];
    equityUsd: UsdAmount;
    venueFilter: PaperVenueId[];
}
export interface MarginEstimateResult {
    ok: boolean;
    requiredUsd: UsdAmount;
    availableUsd: UsdAmount;
    bufferUsd: UsdAmount;
    reason: string | null;
    perLeg: MarginPerLegBreakdown[];
}
export interface MarginEngine {
    estimate(input: MarginEstimateInput): Promise<MarginEstimateResult>;
}
//# sourceMappingURL=margin-engine.d.ts.map