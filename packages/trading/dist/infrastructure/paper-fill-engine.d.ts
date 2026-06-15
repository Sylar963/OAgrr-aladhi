import type { VenueId } from '@oggregator/core';
import { type Fill } from '../domain/fill.js';
import type { Order } from '../domain/order.js';
import type { Clock } from '../ports/clock.js';
import type { FillEngine } from '../ports/fill-engine.js';
import type { QuoteProvider } from '../ports/quote-provider.js';
export declare class PaperFillEngine implements FillEngine {
    private readonly quotes;
    private readonly clock;
    constructor(quotes: QuoteProvider, clock: Clock);
    executeOrder(order: Order, venueFilter: VenueId[]): Promise<Fill[]>;
}
//# sourceMappingURL=paper-fill-engine.d.ts.map