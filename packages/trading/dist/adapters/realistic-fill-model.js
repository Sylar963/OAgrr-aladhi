const DEFAULT_OPTIONS = {
    spreadPenaltyK: 1.0,
    maxSlippagePct: 0.05,
    assumedTopSizeWhenMissing: 1,
};
// Three-tier degradation against a single venue's book:
//   1. quantity ≤ topSize  → fill at L1, zero slippage.
//   2. L2 ladder available → VWAP-walk down/up the book.
//   3. otherwise            → spread-multiplier penalty proportional to
//                             (qty / topSize), capped at maxSlippagePct.
// Returns a partial fill when the available depth (ladder cum-size) is less
// than the requested quantity.
export class RealisticFillModel {
    opts;
    constructor(options = {}) {
        this.opts = { ...DEFAULT_OPTIONS, ...options };
    }
    quote(input) {
        const { side, requestedQuantity, book } = input;
        const reference = side === 'buy' ? book.askUsd : book.bidUsd;
        if (reference == null || reference <= 0) {
            return { priceUsd: 0, filledQuantity: 0, slippageUsd: 0, partial: true };
        }
        const topSize = this.resolveTopSize(side, book);
        if (requestedQuantity <= topSize) {
            return {
                priceUsd: reference,
                filledQuantity: requestedQuantity,
                slippageUsd: 0,
                partial: false,
            };
        }
        const ladder = side === 'buy' ? book.askLevels : book.bidLevels;
        if (ladder && ladder.length > 0) {
            return this.walkLadder(side, requestedQuantity, ladder, reference);
        }
        return this.spreadPenalty(side, requestedQuantity, book, reference, topSize);
    }
    resolveTopSize(side, book) {
        const raw = side === 'buy' ? book.askSize : book.bidSize;
        if (raw != null && raw > 0)
            return raw;
        return this.opts.assumedTopSizeWhenMissing;
    }
    walkLadder(side, requestedQuantity, ladder, reference) {
        const sorted = [...ladder].sort((a, b) => side === 'buy' ? a.priceUsd - b.priceUsd : b.priceUsd - a.priceUsd);
        let remaining = requestedQuantity;
        let notional = 0;
        let filled = 0;
        for (const level of sorted) {
            if (remaining <= 0)
                break;
            const take = Math.min(remaining, level.size);
            notional += take * level.priceUsd;
            filled += take;
            remaining -= take;
        }
        if (filled <= 0) {
            return { priceUsd: 0, filledQuantity: 0, slippageUsd: 0, partial: true };
        }
        const vwap = notional / filled;
        const slippage = side === 'buy' ? vwap - reference : reference - vwap;
        return {
            priceUsd: vwap,
            filledQuantity: filled,
            slippageUsd: Math.max(0, slippage),
            partial: filled < requestedQuantity,
        };
    }
    spreadPenalty(side, requestedQuantity, book, reference, topSize) {
        // Half-spread is the canonical "cost to cross"; size > L1 pays a multiple
        // of it scaled by how much the order overshoots top depth.
        const halfSpread = book.bidUsd != null && book.askUsd != null && book.askUsd > book.bidUsd
            ? (book.askUsd - book.bidUsd) / 2
            : reference * 0.005;
        const overshoot = Math.max(0, requestedQuantity - topSize) / topSize;
        const rawPenalty = this.opts.spreadPenaltyK * halfSpread * (1 + overshoot);
        const cap = reference * this.opts.maxSlippagePct;
        const slippage = Math.min(rawPenalty, cap);
        const priceUsd = side === 'buy' ? reference + slippage : Math.max(0, reference - slippage);
        return {
            priceUsd,
            filledQuantity: requestedQuantity,
            slippageUsd: slippage,
            partial: false,
        };
    }
}
//# sourceMappingURL=realistic-fill-model.js.map