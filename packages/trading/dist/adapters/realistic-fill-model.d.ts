import type { FillModel, FillModelInput, FillModelQuote } from '../gateways/fill-model.js';
export interface RealisticFillModelOptions {
    spreadPenaltyK?: number;
    maxSlippagePct?: number;
    assumedTopSizeWhenMissing?: number;
}
export declare class RealisticFillModel implements FillModel {
    private readonly opts;
    constructor(options?: RealisticFillModelOptions);
    quote(input: FillModelInput): FillModelQuote;
    private resolveTopSize;
    private walkLadder;
    private spreadPenalty;
}
//# sourceMappingURL=realistic-fill-model.d.ts.map