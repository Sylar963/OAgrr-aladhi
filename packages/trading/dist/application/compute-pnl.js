import { computeSnapshot } from '../domain/pnl.js';
export class PnlService {
    positions;
    quotes;
    clock;
    constructor(positions, quotes, clock) {
        this.positions = positions;
        this.quotes = quotes;
        this.clock = clock;
    }
    async snapshot(accountId) {
        const [open, cash] = await Promise.all([
            this.positions.listPositions(accountId),
            this.positions.getCashBalance(accountId),
        ]);
        const marks = new Map();
        await Promise.all(open.map(async (p) => {
            if (p.netQuantity === 0)
                return;
            const mark = await this.quotes.getMark({
                underlying: p.key.underlying,
                expiry: p.key.expiry,
                strike: p.key.strike,
                optionRight: p.key.optionRight,
            });
            const k = `${p.key.underlying}|${p.key.expiry}|${p.key.strike}|${p.key.optionRight}`;
            marks.set(k, mark);
        }));
        return computeSnapshot(open, marks, cash, this.clock.now());
    }
}
//# sourceMappingURL=compute-pnl.js.map