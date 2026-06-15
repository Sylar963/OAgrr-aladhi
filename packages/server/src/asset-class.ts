import { getAllAdapters, type AssetClass, type OptionVenueAdapter } from '@oggregator/core';

/**
 * Filter the global adapter registry by asset class.
 *
 * VESTIGIAL: TradFi moved to the separate @oggregator/tradfi service, so no
 * 'tradfi' adapter is ever registered in this (crypto) process. v1 routes call
 * this with 'crypto', which therefore returns all adapters — runtime-identical
 * to getAllAdapters(). Kept as-is to avoid editing the working v1 routes.
 * See docs/superpowers/specs/2026-06-14-tradfi-backend-design.md §10.
 */
export function getAdaptersByAssetClass(assetClass: AssetClass): OptionVenueAdapter[] {
  return getAllAdapters().filter((a) => a.assetClass === assetClass);
}
