import { getAllAdapters, type AssetClass, type OptionVenueAdapter } from '@oggregator/core';

/**
 * Filter the global adapter registry by asset class.
 *
 * v1 routes (/api/*) consume `'crypto'`. v2 routes (/api/v2/*) consume `'tradfi'`.
 * Adapters default to `'crypto'` unless they explicitly override.
 */
export function getAdaptersByAssetClass(assetClass: AssetClass): OptionVenueAdapter[] {
  return getAllAdapters().filter((a) => a.assetClass === assetClass);
}
