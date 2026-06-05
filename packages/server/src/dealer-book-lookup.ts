import type { BookLookup, DealerPosition, VenueId } from '@oggregator/core';

let registered: BookLookup | undefined;

export function registerBookLookup(fn: BookLookup): void {
  registered = fn;
}

export function bookLookup(venue: VenueId, symbol: string): DealerPosition | undefined {
  return registered?.(venue, symbol);
}
