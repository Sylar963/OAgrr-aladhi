import type { SpotCandleCurrency } from '@oggregator/core';

import { spotCandleService } from './services.js';
import type { PriceAtLookup } from './venue-position-persistence.js';

const PRICED_UNDERLYINGS = new Set<string>(['BTC', 'ETH', 'HYPE'] satisfies SpotCandleCurrency[]);

export const portfolioFillPriceAt: PriceAtLookup = (underlying, timestampMs) =>
  PRICED_UNDERLYINGS.has(underlying)
    ? spotCandleService.getPriceAt(underlying as SpotCandleCurrency, timestampMs)
    : Promise.resolve(null);
