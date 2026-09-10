import type { PaperTradingStore } from '@oggregator/db';
import type { AccountId } from '../book/account.js';
import type { FillEconomics } from '../book/pnl.js';
import type { FillEconomicsRepository } from '../gateways/fill-economics-repository.js';

export class PostgresFillEconomicsRepository implements FillEconomicsRepository {
  constructor(private readonly store: PaperTradingStore) {}

  listFillEconomics(accountId: AccountId): Promise<FillEconomics[]> {
    return this.store.listFillEconomics(accountId);
  }
}
