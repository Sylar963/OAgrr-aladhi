import type { AccountId } from '../domain/account.js';
import { type PnlSnapshot } from '../domain/pnl.js';
import type { Clock } from '../ports/clock.js';
import type { PositionRepository } from '../ports/position-repository.js';
import type { QuoteProvider } from '../ports/quote-provider.js';
export declare class PnlService {
    private readonly positions;
    private readonly quotes;
    private readonly clock;
    constructor(positions: PositionRepository, quotes: QuoteProvider, clock: Clock);
    snapshot(accountId: AccountId): Promise<PnlSnapshot>;
}
//# sourceMappingURL=compute-pnl.d.ts.map