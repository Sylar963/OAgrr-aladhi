import type { QuoteProvider } from '../gateways/quote-provider.js';
import type { MarginEngine, MarginEstimateInput, MarginEstimateResult } from './margin-engine.js';
export interface ApproximationMarginEngineOptions {
    bufferPct?: number;
    k1?: number;
    k2?: number;
}
export declare class ApproximationMarginEngine implements MarginEngine {
    private readonly quotes;
    private readonly opts;
    constructor(quotes: QuoteProvider, options?: ApproximationMarginEngineOptions);
    estimate(input: MarginEstimateInput): Promise<MarginEstimateResult>;
    private spotForLeg;
    private existingShortMargin;
}
//# sourceMappingURL=approximation-margin-engine.d.ts.map