import type { VenueId } from '@oggregator/core';
import { newFillId, type Fill } from '../book/fill.js';
import type { Order, OrderLeg } from '../book/order.js';
import { NoLiquidityError } from '../book/errors.js';
import type { Clock } from '../gateways/clock.js';
import type { FillEngine } from '../gateways/fill-engine.js';
import type { QuoteBook, QuoteProvider } from '../gateways/quote-provider.js';

export class PaperFillEngine implements FillEngine {
  constructor(
    private readonly quotes: QuoteProvider,
    private readonly clock: Clock,
  ) {}

  async executeOrder(order: Order, venueFilter: VenueId[]): Promise<Fill[]> {
    const plans: Array<{ leg: OrderLeg; venue: VenueId; priceUsd: number; feesUsd: number }> = [];

    for (const leg of order.legs) {
      const venues = leg.preferredVenues ?? venueFilter;
      const books = await this.quotes.getBooks(
        {
          underlying: leg.underlying,
          expiry: leg.expiry,
          strike: leg.strike,
          optionRight: leg.optionRight,
        },
        venues,
      );

      const chosen = pickBestBook(books, leg.side);
      if (!chosen) {
        throw new NoLiquidityError(
          `No ${leg.side === 'buy' ? 'ask' : 'bid'} available for leg ${leg.index}`,
          leg.index,
        );
      }

      const priceUsd = leg.side === 'buy' ? chosen.book.askUsd! : chosen.book.bidUsd!;
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
    return plans.map(
      (p): Fill => ({
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
      }),
    );
  }
}

function pickBestBook(
  books: QuoteBook[],
  side: 'buy' | 'sell',
): { book: QuoteBook } | null {
  const priced = books.filter((b) => (side === 'buy' ? b.askUsd != null : b.bidUsd != null));
  if (priced.length === 0) return null;
  const sorted = [...priced].sort((a, b) => {
    const priceA = side === 'buy' ? a.askUsd! : -a.bidUsd!;
    const priceB = side === 'buy' ? b.askUsd! : -b.bidUsd!;
    return priceA - priceB;
  });
  return { book: sorted[0]! };
}
