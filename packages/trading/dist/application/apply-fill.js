import { fillCashDelta } from '../domain/fill.js';
import { applyFillToPosition, keyFromFill } from '../domain/position.js';
/**
 * Atomic for a single fill:
 *  1. Load prior position for the (account, symbol) key
 *  2. Fold the fill into it
 *  3. Persist the new position + cash ledger entry
 */
export async function applyFill(positions, accountId, fill) {
    const all = await positions.listPositions(accountId);
    const key = keyFromFill(accountId, fill);
    const prior = all.find((p) => positionMatches(p, key)) ?? null;
    const next = applyFillToPosition(prior ? { ...prior, key: prior.key } : null, fill);
    const nextWithAccount = { ...next, key: { ...next.key, accountId } };
    await positions.upsertPosition(nextWithAccount);
    await positions.appendCashLedger({
        accountId,
        deltaUsd: fillCashDelta(fill),
        reason: 'fill',
        refId: fill.id,
        ts: fill.filledAt,
    });
    return nextWithAccount;
}
function positionMatches(pos, key) {
    return (pos.key.accountId === key.accountId &&
        pos.key.underlying === key.underlying &&
        pos.key.expiry === key.expiry &&
        pos.key.strike === key.strike &&
        pos.key.optionRight === key.optionRight);
}
//# sourceMappingURL=apply-fill.js.map