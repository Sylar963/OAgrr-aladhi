import type { AccountId } from '../book/account.js';
import { type PnlSnapshot } from '../book/pnl.js';
import type { Clock } from '../gateways/clock.js';
import type { PositionRepository } from '../gateways/position-repository.js';
import type { QuoteProvider } from '../gateways/quote-provider.js';
export declare class PnlService {
    private readonly positions;
    private readonly quotes;
    private readonly clock;
    constructor(positions: PositionRepository, quotes: QuoteProvider, clock: Clock);
    snapshot(accountId: AccountId): Promise<PnlSnapshot>;
}
//# sourceMappingURL=compute-pnl.d.ts.map