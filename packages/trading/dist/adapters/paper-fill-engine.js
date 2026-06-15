import { newFillId } from '../book/fill.js';
import { NoLiquidityError } from '../book/errors.js';
import { OptimisticFillModel } from './optimistic-fill-model.js';
export class PaperFillEngine {
    quotes;
    clock;
    fillModel;
    constructor(quotes, clock, fillModel) {
        this.quotes = quotes;
        this.clock = clock;
        this.fillModel = fillModel ?? new OptimisticFillModel();
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
            const quote = this.fillModel.quote({
                side: leg.side,
                requestedQuantity: leg.quantity,
                book: chosen.book,
            });
            if (quote.filledQuantity <= 0) {
                throw new NoLiquidityError(`Fill model returned zero size for leg ${leg.index}`, leg.index);
            }
            const feesUsd = chosen.book.feesTakerUsd * quote.filledQuantity;
            plans.push({
                leg,
                venue: chosen.book.venue,
                priceUsd: quote.priceUsd,
                filledQuantity: quote.filledQuantity,
                slippageUsd: quote.slippageUsd,
                partialFill: quote.partial,
                feesUsd,
                benchmarkBidUsd: chosen.book.bidUsd,
                benchmarkAskUsd: chosen.book.askUsd,
                benchmarkMidUsd: chosen.book.markUsd,
                underlyingSpotUsd: chosen.book.underlyingPriceUsd,
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
            quantity: p.filledQuantity,
            requestedQuantity: p.leg.quantity,
            priceUsd: p.priceUsd,
            feesUsd: p.feesUsd,
            slippageUsd: p.slippageUsd,
            partialFill: p.partialFill,
            benchmarkBidUsd: p.benchmarkBidUsd,
            benchmarkAskUsd: p.benchmarkAskUsd,
            benchmarkMidUsd: p.benchmarkMidUsd,
            underlyingSpotUsd: p.underlyingSpotUsd,
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