import type { PaperVenueId } from '@oggregator/protocol';
import { type Fill } from '../book/fill.js';
import type { Order } from '../book/order.js';
import type { Clock } from '../gateways/clock.js';
import type { FillEngine } from '../gateways/fill-engine.js';
import type { FillModel } from '../gateways/fill-model.js';
import type { QuoteProvider } from '../gateways/quote-provider.js';
export declare class PaperFillEngine implements FillEngine {
    private readonly quotes;
    private readonly clock;
    private readonly fillModel;
    constructor(quotes: QuoteProvider, clock: Clock, fillModel?: FillModel);
    executeOrder(order: Order, venueFilter: PaperVenueId[]): Promise<Fill[]>;
}
//# sourceMappingURL=paper-fill-engine.d.ts.map