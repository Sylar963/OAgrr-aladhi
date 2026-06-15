import type { AccountId } from '../book/account.js';
export interface PortfolioGreeks {
    delta: number;
    gamma: number;
    theta: number;
    vega: number;
}
/**
 * Stub — real body lands alongside the analytics feature. The shape matches
 * what enrichment.computeChainStats already surfaces per strike, so aggregation
 * is a sum across open positions weighted by net quantity.
 */
export declare function computePortfolioGreeks(_accountId: AccountId): Promise<PortfolioGreeks>;
//# sourceMappingURL=portfolio-greeks.d.ts.map