import { newFillId } from '../domain/fill.js';
import { NoLiquidityError } from '../domain/errors.js';
export class PaperFillEngine {
    quotes;
    clock;
    constructor(quotes, clock) {
        this.quotes = quotes;
        this.clock = clock;
    }
    async executeOrder(order, venueFilter) {
        const plans = [];
        for (const leg of order.legs) {
            const venues = leg.preferredVenues ?? venueFilter;
            const books = await this.quotes.getBooks({
                underlying: leg.underlying,
                expiry: leg.expiry,
                strike: leg.strike,
                optionRight: leg.optionRight,
            }, venues);
            const chosen = pickBestBook(books, leg.side);
            if (!chosen) {
                throw new NoLiquidityError(`No ${leg.side === 'buy' ? 'ask' : 'bid'} available for leg ${leg.index}`, leg.index);
            }
            const priceUsd = leg.side === 'buy' ? chosen.book.askUsd : chosen.book.bidUsd;
            const notionalUsd = priceUsd * leg.quantity;
            const feesUsd = notionalUsd * chosen.book.feesTakerRate;
            plans.push({
                leg,
                venue: chosen.book.venue,
                priceUsd,
                feesUsd,
            });
        }
        const now = this.clock.now();
        return plans.map((p) => ({
            id: newFillId(),
            orderId: order.id,
            legIndex: p.leg.index,
            venue: p.venue,
            side: p.leg.side,
            optionRight: p.leg.optionRight,
            underlying: p.leg.underlying,
            expiry: p.leg.expiry,
            strike: p.leg.strike,
            quantity: p.leg.quantity,
            priceUsd: p.priceUsd,
            feesUsd: p.feesUsd,
            source: 'paper',
            filledAt: now,
        }));
    }
}
function pickBestBook(books, side) {
    const priced = books.filter((b) => (side === 'buy' ? b.askUsd != null : b.bidUsd != null));
    if (priced.length === 0)
        return null;
    const sorted = [...priced].sort((a, b) => {
        const priceA = side === 'buy' ? a.askUsd : -a.bidUsd;
        const priceB = side === 'buy' ? b.askUsd : -b.bidUsd;
        return priceA - priceB;
    });
    return { book: sorted[0] };
}
//# sourceMappingURL=paper-fill-engine.js.map