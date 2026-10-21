import type { VenueId } from '../types/common.js';

// Fee cap: limits fee to this fraction of the option premium.
// Without it, OTM options with tiny premiums would have absurdly high fees
// relative to their price (e.g. 0.03% × $70K underlying = $21 on a $5 option).
export const VENUE_FEE_CAP: Record<VenueId, number> = {
  deribit: 0.125, // 12.5% of option price
  okx: 0.125, // 12.5% of option price
  bybit: 0.125, // 12.5% of option price
  binance: 0.1, // 10% of option price
  derive: 0.125, // 12.5% of option premium
  coincall: 0.125, // 12.5% of option premium
  thalex: 0.125, // 12.5% of option premium
  gateio: 0.125, // venue-published price_limit_fee_rate on every options contract
  paradex: 0.125, // fee_config.api_fee fee_cap = 0.125 on every options market (verified live 2026-06-08)
};

// Public Tier 1 estimate; account discounts and combo reductions apply at execution.
// https://thalex.com/trading-information/fees (verified 2026-09-18)
export const THALEX_OPTION_FEE_RATE = 0.00015;

/**
 * Taker fee in USD for `size` contracts: min(rate × underlying, cap × premium) per contract.
 * Without an underlying price only the premium cap is known, so the cap is charged in full.
 */
export function cappedTakerFeeUsd(
  rate: number,
  cap: number,
  premiumUsd: number,
  underlyingPriceUsd: number | null,
  size = 1,
): number {
  const capped = cap * Math.max(0, premiumUsd);
  const perContract =
    underlyingPriceUsd != null && underlyingPriceUsd > 0
      ? Math.min(rate * underlyingPriceUsd, capped)
      : capped;
  return perContract * Math.max(0, size);
}
