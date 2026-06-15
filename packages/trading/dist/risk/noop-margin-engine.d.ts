import type { MarginEngine, MarginEstimateInput, MarginEstimateResult } from './margin-engine.js';
export declare class NoopMarginEngine implements MarginEngine {
    estimate(input: MarginEstimateInput): Promise<MarginEstimateResult>;
}
//# sourceMappingURL=noop-margin-engine.d.ts.map