import type { PaperVenueId } from '@oggregator/protocol';
export interface QuoteBookLevel {
    priceUsd: number;
    size: number;
}
export interface QuoteBook {
    venue: PaperVenueId;
    bidUsd: number | null;
    askUsd: number | null;
    markUsd: number | null;
    underlyingPriceUsd: number | null;
    /** Absolute USD taker fee per contract (not a rate). */
    feesTakerUsd: number;
    bidSize: number | null;
    askSize: number | null;
    bidLevels?: QuoteBookLevel[];
    askLevels?: QuoteBookLevel[];
}
export interface QuoteKey {
    underlying: string;
    expiry: string;
    strike: number;
    optionRight: 'call' | 'put';
}
export interface QuoteProvider {
    /**
     * Return the best quotes across the given venues for the option.
     * Missing venues are simply absent from the returned array.
     */
    getBooks(key: QuoteKey, venues: PaperVenueId[]): Promise<QuoteBook[]>;
    /** Current mark price in USD, best-effort across all venues. */
    getMark(key: QuoteKey): Promise<number | null>;
}
//# sourceMappingURL=quote-provider.d.ts.map