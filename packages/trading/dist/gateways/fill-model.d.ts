import type { QuoteBook } from './quote-provider.js';
export interface FillModelInput {
    side: 'buy' | 'sell';
    requestedQuantity: number;
    book: QuoteBook;
}
export interface FillModelQuote {
    priceUsd: number;
    filledQuantity: number;
    slippageUsd: number;
    partial: boolean;
}
export interface FillModel {
    quote(input: FillModelInput): FillModelQuote;
}
//# sourceMappingURL=fill-model.d.ts.map