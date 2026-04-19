import type { VenueId } from '@oggregator/core';

export interface QuoteBook {
  venue: VenueId;
  bidUsd: number | null;
  askUsd: number | null;
  markUsd: number | null;
  underlyingPriceUsd: number | null;
  feesTakerRate: number;
}

export interface QuoteKey {
  underlying: string;
  expiry: string;
  strike: number;
  optionRight: 'call' | 'put';
}

export interface QuoteProvider {
  /**
   * Return the best quotes across the given venues for the option.
   * Missing venues are simply absent from the returned array.
   */
  getBooks(key: QuoteKey, venues: VenueId[]): Promise<QuoteBook[]>;

  /** Current mark price in USD, best-effort across all venues. */
  getMark(key: QuoteKey): Promise<number | null>;
}
