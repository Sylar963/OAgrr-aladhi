import type { AccountId } from '../book/account.js';
import type { FillEconomics } from '../book/pnl.js';

export interface FillEconomicsRepository {
  listFillEconomics(accountId: AccountId): Promise<FillEconomics[]>;
}
