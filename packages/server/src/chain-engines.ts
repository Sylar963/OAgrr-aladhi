import { ChainRuntimeRegistry } from '@oggregator/core';
import { venueSubscriptions } from './venue-subscriptions.js';

export const chainEngines = new ChainRuntimeRegistry({
  coordinator: venueSubscriptions,
  log: { warn: () => {} },
});
