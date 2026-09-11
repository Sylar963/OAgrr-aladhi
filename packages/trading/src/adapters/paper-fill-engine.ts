import type { VenueId } from '@oggregator/core';
import { NoLiquidityError } from '../book/errors.js';
import { type Fill, newFillId } from '../book/fill.js';
import type { Order, OrderLeg } from '../book/order.js';
import type { Clock } from '../gateways/clock.js';
import type { FillEngine } from '../gateways/fill-engine.js';
import type { FillModel } from '../gateways/fill-model.js';
import type { QuoteBook, QuoteProvider } from '../gateways/quote-provider.js';
import { OptimisticFillModel } from './optimistic-fill-model.js';

const MAX_QUOTE_AGE_MS = 60_000;

export class PaperFillEngine implements FillEngine {
  private readonly fillModel: FillModel;

  constructor(
    private readonly quotes: QuoteProvider,
    private readonly clock: Clock,
    fillModel?: FillModel,
  ) {
    this.fillModel = fillModel ?? new OptimisticFillModel();
  }

  async executeOrder(order: Order, venueFilter: VenueId[]): Promise<Fill[]> {
    const decisionAtMs = this.clock.now().getTime();
    const plans: Array<{
      leg: OrderLeg;
      book: QuoteBook;
      venue: VenueId;
      priceUsd: number;
      filledQuantity: number;
      slippageUsd: number;
      partialFill: boolean;
      feesUsd: number;
      benchmarkBidUsd: number | null;
      benchmarkAskUsd: number | null;
      benchmarkMidUsd: number | null;
      iv: number | null;
      underlyingSpotUsd: number | null;
    }> = [];

    for (const leg of order.legs) {
      const venues = resolveVenues(leg.preferredVenues, venueFilter);
      if (venues == null) {
        throw new NoLiquidityError(`No permitted venue for leg ${leg.index}`, leg.index);
      }
      const books = await this.quotes.getBooks(
        {
          underlying: leg.underlying,
          expiry: leg.expiry,
          strike: leg.strike,
          optionRight: leg.optionRight,
        },
        venues,
      );

      const chosen = pickBestBook(books, leg.side, leg.quantity, decisionAtMs);
      if (!chosen) {
        throw new NoLiquidityError(
          `No ${leg.side === 'buy' ? 'ask' : 'bid'} available for leg ${leg.index}`,
          leg.index,
        );
      }

      const quote = this.fillModel.quote({
        side: leg.side,
        requestedQuantity: leg.quantity,
        book: chosen.book,
      });
      if (!isValidFillQuote(chosen.book, quote, leg.quantity)) {
        throw new NoLiquidityError(
          `Fill model returned an invalid fill for leg ${leg.index}`,
          leg.index,
        );
      }

      const feesUsd = chosen.feePerBase * quote.filledQuantity;

      plans.push({
        leg,
        book: chosen.book,
        venue: chosen.book.venue,
        priceUsd: quote.priceUsd,
        filledQuantity: quote.filledQuantity,
        slippageUsd: quote.slippageUsd,
        partialFill: quote.filledQuantity < leg.quantity - 1e-9 * Math.max(1, leg.quantity),
        feesUsd,
        benchmarkBidUsd: chosen.book.bidUsd,
        benchmarkAskUsd: chosen.book.askUsd,
        benchmarkMidUsd: chosen.book.markUsd,
        iv: chosen.book.markIv,
        underlyingSpotUsd: chosen.book.underlyingPriceUsd,
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
        quantity: p.filledQuantity,
        requestedQuantity: p.leg.quantity,
        quantityUnit: 'base',
        contractMultiplierBase: p.book.contractMultiplierBase,
        nativeQuantity: p.filledQuantity / p.book.contractMultiplierBase,
        requestedNativeQuantity: p.leg.quantity / p.book.contractMultiplierBase,
        nativeMinQuantity: p.book.nativeMinQuantity,
        nativeQuantityStep: p.book.nativeQuantityStep,
        nativePriceTick: p.book.nativePriceTick,
        priceUsd: p.priceUsd,
        iv: p.iv,
        feesUsd: p.feesUsd,
        slippageUsd: p.slippageUsd,
        partialFill: p.partialFill,
        benchmarkBidUsd: p.benchmarkBidUsd,
        benchmarkAskUsd: p.benchmarkAskUsd,
        benchmarkMidUsd: p.benchmarkMidUsd,
        underlyingSpotUsd: p.underlyingSpotUsd,
        source: 'paper',
        filledAt: now,
      }),
    );
  }
}

function pickBestBook(
  books: QuoteBook[],
  side: 'buy' | 'sell',
  quantity: number,
  decisionAtMs: number,
): { book: QuoteBook; feePerBase: number } | null {
  const candidates: Array<{ book: QuoteBook; feePerBase: number; allInUsd: number }> = [];
  for (const book of books) {
    const price = side === 'buy' ? book.askUsd : book.bidUsd;
    const fee = side === 'buy' ? book.askTakerFeeUsd : book.bidTakerFeeUsd;
    if (
      !isFresh(book, decisionAtMs) ||
      !isValidQuantity(book, quantity) ||
      price == null ||
      !Number.isFinite(price) ||
      price <= 0 ||
      fee == null ||
      !Number.isFinite(fee) ||
      fee < 0
    ) {
      continue;
    }
    const allInUsd = side === 'buy' ? price + fee : price - fee;
    if (!Number.isFinite(allInUsd)) continue;
    candidates.push({ book, feePerBase: fee, allInUsd });
  }
  candidates.sort((a, b) => {
    const priceOrder = side === 'buy' ? a.allInUsd - b.allInUsd : b.allInUsd - a.allInUsd;
    return priceOrder || a.book.venue.localeCompare(b.book.venue);
  });
  const chosen = candidates[0];
  return chosen ? { book: chosen.book, feePerBase: chosen.feePerBase } : null;
}

function resolveVenues(
  preferredVenues: VenueId[] | null,
  venueFilter: VenueId[],
): VenueId[] | null {
  if (preferredVenues == null) return venueFilter;
  if (preferredVenues.length === 0) return null;
  if (venueFilter.length === 0) return [...new Set(preferredVenues)];
  const allowed = new Set(venueFilter);
  const intersection = [...new Set(preferredVenues)].filter((venue) => allowed.has(venue));
  return intersection.length > 0 ? intersection : null;
}

function isValidQuantity(book: QuoteBook, quantity: number): boolean {
  if (
    book.quantityUnit !== 'base' ||
    !Number.isFinite(book.contractMultiplierBase) ||
    book.contractMultiplierBase <= 0 ||
    !Number.isFinite(book.minQuantity) ||
    book.minQuantity <= 0 ||
    !Number.isFinite(book.quantityStep) ||
    book.quantityStep <= 0 ||
    !Number.isFinite(quantity) ||
    quantity < book.minQuantity
  ) {
    return false;
  }
  const steps = quantity / book.quantityStep;
  const nearest = Math.round(steps);
  return Math.abs(steps - nearest) <= 1e-9 * Math.max(1, Math.abs(steps));
}

function isFresh(book: QuoteBook, decisionAtMs: number): boolean {
  const asOfMs = book.asOfMs;
  return (
    asOfMs != null &&
    Number.isFinite(asOfMs) &&
    asOfMs > 0 &&
    asOfMs <= decisionAtMs &&
    decisionAtMs - asOfMs <= MAX_QUOTE_AGE_MS
  );
}

function isValidFillQuote(
  book: QuoteBook,
  quote: { priceUsd: number; filledQuantity: number; slippageUsd: number },
  requestedQuantity: number,
): boolean {
  const tolerance = 1e-9 * Math.max(1, requestedQuantity);
  return (
    Number.isFinite(quote.priceUsd) &&
    quote.priceUsd > 0 &&
    Number.isFinite(quote.filledQuantity) &&
    quote.filledQuantity >= book.minQuantity &&
    quote.filledQuantity <= requestedQuantity + tolerance &&
    isValidQuantity(book, quote.filledQuantity) &&
    Number.isFinite(quote.slippageUsd) &&
    quote.slippageUsd >= 0
  );
}
