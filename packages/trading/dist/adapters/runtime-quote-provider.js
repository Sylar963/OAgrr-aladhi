import { PAPER_VENUE_IDS } from '@oggregator/protocol';
const DEFAULT_FEES_TAKER_USD = 0;
export class RuntimeQuoteProvider {
    registry;
    constructor(registry) {
        this.registry = registry;
    }
    async getBooks(key, venues) {
        const requestedVenues = venues.length > 0 ? venues : [...PAPER_VENUE_IDS];
        const { runtime, release } = await this.registry.acquire({
            underlying: key.underlying,
            expiry: key.expiry,
            venues: requestedVenues,
        });
        try {
            const snapshot = await runtime.fetchSnapshotData();
            const strike = snapshot.strikes.find((s) => s.strike === key.strike);
            if (!strike)
                return [];
            const side = key.optionRight === 'call' ? strike.call : strike.put;
            const books = [];
            for (const [venueId, quote] of Object.entries(side.venues)) {
                const venue = venueId;
                if (!requestedVenues.includes(venue))
                    continue;
                if (!quote)
                    continue;
                books.push({
                    venue,
                    bidUsd: quote.bid,
                    askUsd: quote.ask,
                    markUsd: quote.mid,
                    underlyingPriceUsd: snapshot.stats.forwardPriceUsd ?? snapshot.stats.indexPriceUsd,
                    feesTakerUsd: quote.estimatedFees?.taker ?? DEFAULT_FEES_TAKER_USD,
                    bidSize: quote.bidSize,
                    askSize: quote.askSize,
                });
            }
            return books;
        }
        finally {
            await release();
        }
    }
    async getMark(key) {
        const books = await this.getBooks(key, [...PAPER_VENUE_IDS]);
        const marks = books.map((b) => b.markUsd).filter((m) => m != null);
        if (marks.length === 0)
            return null;
        return marks.reduce((sum, m) => sum + m, 0) / marks.length;
    }
}
//# sourceMappingURL=runtime-quote-provider.js.map