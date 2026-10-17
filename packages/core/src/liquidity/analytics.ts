import type { BookLevel, BookSide, OrderBookSnapshot } from './types.js';

export interface FillEstimate {
  side: BookSide;
  requested: number;
  filled: number;
  fullyFilled: boolean;
  /** Volume-weighted average price of the filled part; null when nothing fills. */
  vwap: number | null;
  worstPrice: number | null;
  notional: number;
  levelsUsed: number;
  /** Per unit, signed so positive always means worse for the taker. */
  slippageVsTouch: number | null;
  slippageVsTouchPct: number | null;
  slippageVsMark: number | null;
  slippageVsMarkPct: number | null;
}

export interface DepthBand {
  pct: number;
  bidAmount: number;
  askAmount: number;
  bidNotional: number;
  askNotional: number;
}

export interface DepthPoint {
  price: number;
  cumulativeAmount: number;
  cumulativeNotional: number;
}

/** A buyer takes asks, a seller hits bids. */
function takenLevels(book: OrderBookSnapshot, side: BookSide): BookLevel[] {
  return side === 'buy' ? book.asks : book.bids;
}

function usable(level: BookLevel): boolean {
  return Number.isFinite(level.price) && level.price > 0 && Number.isFinite(level.amount) && level.amount > 0;
}

/** Walks the opposite side of the book until `size` is filled or the book runs out. */
export function costToFill(book: OrderBookSnapshot, side: BookSide, size: number): FillEstimate {
  const levels = takenLevels(book, side).filter(usable);
  let filled = 0;
  let notional = 0;
  let worstPrice: number | null = null;
  let levelsUsed = 0;
  for (const level of levels) {
    if (filled >= size) break;
    const take = Math.min(level.amount, size - filled);
    filled += take;
    notional += take * level.price;
    worstPrice = level.price;
    levelsUsed += 1;
  }
  const vwap = filled > 0 ? notional / filled : null;
  const sign = side === 'buy' ? 1 : -1;
  const touch = levels[0]?.price ?? null;
  const mark = book.mark?.markPrice ?? null;
  const slip = (ref: number | null) => (vwap !== null && ref !== null ? sign * (vwap - ref) : null);
  const pct = (value: number | null, ref: number | null) =>
    value !== null && ref !== null && ref > 0 ? (value / ref) * 100 : null;
  const slippageVsTouch = slip(touch);
  const slippageVsMark = slip(mark);
  return {
    side,
    requested: size,
    filled,
    // Float sums of tick-sized amounts can land a hair under the request.
    fullyFilled: filled >= size - 1e-9,
    vwap,
    worstPrice,
    notional,
    levelsUsed,
    slippageVsTouch,
    slippageVsTouchPct: pct(slippageVsTouch, touch),
    slippageVsMark,
    slippageVsMarkPct: pct(slippageVsMark, mark),
  };
}

/** Mark when there is one, else the mid, else null. */
export function referencePrice(book: OrderBookSnapshot): number | null {
  if (book.mark && book.mark.markPrice > 0) return book.mark.markPrice;
  const bid = book.bids.find(usable)?.price;
  const ask = book.asks.find(usable)?.price;
  return bid !== undefined && ask !== undefined ? (bid + ask) / 2 : null;
}

export function depthWithin(
  book: OrderBookSnapshot,
  pcts: readonly number[],
  reference: number | null = referencePrice(book),
): DepthBand[] {
  return pcts.map((pct) => {
    const band: DepthBand = { pct, bidAmount: 0, askAmount: 0, bidNotional: 0, askNotional: 0 };
    if (reference === null) return band;
    const low = reference * (1 - pct / 100);
    const high = reference * (1 + pct / 100);
    for (const level of book.bids.filter(usable)) {
      if (level.price < low) break;
      band.bidAmount += level.amount;
      band.bidNotional += level.amount * level.price;
    }
    for (const level of book.asks.filter(usable)) {
      if (level.price > high) break;
      band.askAmount += level.amount;
      band.askNotional += level.amount * level.price;
    }
    return band;
  });
}

export function depthCurve(book: OrderBookSnapshot, side: BookSide): DepthPoint[] {
  let cumulativeAmount = 0;
  let cumulativeNotional = 0;
  return takenLevels(book, side)
    .filter(usable)
    .map((level) => {
      cumulativeAmount += level.amount;
      cumulativeNotional += level.amount * level.price;
      return { price: level.price, cumulativeAmount, cumulativeNotional };
    });
}
