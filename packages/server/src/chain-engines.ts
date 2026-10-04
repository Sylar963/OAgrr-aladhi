import { ChainRuntimeRegistry, logger } from '@oggregator/core';
import { bookLookup } from './dealer-book-lookup.js';
import { venueSubscriptions } from './venue-subscriptions.js';

const log = logger.child({ component: 'chain-runtime' });

export const chainEngines = new ChainRuntimeRegistry({
  coordinator: venueSubscriptions,
  log: { warn: (obj, msg) => log.warn(obj, msg) },
  bookLookup,
});
