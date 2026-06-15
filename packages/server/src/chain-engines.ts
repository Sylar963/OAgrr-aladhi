import { ChainRuntimeRegistry } from '@oggregator/core';
import { bookLookup } from './dealer-book-lookup.js';
import { venueSubscriptions } from './venue-subscriptions.js';

export const chainEngines = new ChainRuntimeRegistry({
  coordinator: venueSubscriptions,
  log: { warn: () => {} },
  bookLookup,
});
