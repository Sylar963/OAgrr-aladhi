import type { PaperVenueId } from '@oggregator/protocol';
import { ChainRuntimeRegistry } from '@oggregator/core';
import type { QuoteBook, QuoteKey, QuoteProvider } from '../gateways/quote-provider.js';
export declare class RuntimeQuoteProvider implements QuoteProvider {
    private readonly registry;
    constructor(registry: ChainRuntimeRegistry);
    getBooks(key: QuoteKey, venues: PaperVenueId[]): Promise<QuoteBook[]>;
    getMark(key: QuoteKey): Promise<number | null>;
}
//# sourceMappingURL=runtime-quote-provider.d.ts.map