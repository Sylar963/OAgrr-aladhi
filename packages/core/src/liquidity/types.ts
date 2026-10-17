/**
 * Canonical L2 book shape. First one in the repo; the simulator's S1 book contract should adopt
 * or extend it rather than define a second one.
 */
export interface BookLevel {
  price: number;
  /** Executable size at this price, including implied liquidity. */
  amount: number;
  /** Resting orders in this book only (0 on fully implied combo books). */
  outrightAmount: number;
}

/**
 * `uninitialized` until the first snapshot; `unsynchronized` after a disconnect or an invalid
 * frame, until the next snapshot. Only `synced` books are safe to estimate from.
 */
export type BookSyncState = 'uninitialized' | 'synced' | 'unsynchronized';

export interface BookMark {
  markPrice: number;
  indexPrice: number | null;
  delta: number | null;
  iv: number | null;
  collarLow: number | null;
  collarHigh: number | null;
  receivedAt: number;
}

export interface OrderBookSnapshot {
  venue: 'thalex';
  instrument: string;
  priceUnit: 'usd';
  quantityUnit: 'base';
  /** Best first (descending). */
  bids: BookLevel[];
  /** Best first (ascending). */
  asks: BookLevel[];
  totalBidAmount: number | null;
  totalAskAmount: number | null;
  /** Venue timestamp in ms; null when the venue doesn't provide one (combo books send 0). */
  exchangeTs: number | null;
  receivedAt: number;
  /** Bumps on every reconnect, so a consumer can tell a fresh snapshot from a stale one. */
  generation: number;
  state: BookSyncState;
  crossed: boolean;
  mark: BookMark | null;
}

export type BookSide = 'buy' | 'sell';
