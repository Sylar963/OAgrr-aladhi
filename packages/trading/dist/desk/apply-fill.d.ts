import type { AccountId } from '../book/account.js';
import type { Fill } from '../book/fill.js';
import { type Position } from '../book/position.js';
import type { PositionRepository } from '../gateways/position-repository.js';
/**
 * Atomic for a single fill:
 *  1. Load prior position for the (account, symbol) key
 *  2. Fold the fill into it
 *  3. Persist the new position + cash ledger entry
 */
export declare function applyFill(positions: PositionRepository, accountId: AccountId, fill: Fill): Promise<Position>;
//# sourceMappingURL=apply-fill.d.ts.map