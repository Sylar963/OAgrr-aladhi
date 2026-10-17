/**
 * Underlyings the /spot-candles route can chart. Core maps each one to a price
 * source (Deribit perps for BTC/ETH, Hyperliquid perps for the rest, including
 * HIP-3 equity/commodity markets), so adding a symbol here without a core
 * mapping is a type error.
 */
export const SPOT_CANDLE_UNDERLYINGS = [
  'BTC',
  'BTC_USDC',
  'ETH',
  'ETH_USDC',
  'HYPE',
  'AAVE',
  'ADA',
  'AVAX',
  'BNB',
  'DOGE',
  'ENA',
  'KAS',
  'LIT',
  'LTC',
  'NEAR',
  'ORDI',
  'SOL',
  'SUI',
  'TRUMP',
  'TRX',
  'WLFI',
  'XRP',
  'ZEC',
  'CL',
  'META',
  'MSTR',
  'MU',
  'SPCX',
  'US100',
  'US500',
  'XAU',
  'XAUT',
] as const;

export type SpotCandleUnderlying = (typeof SPOT_CANDLE_UNDERLYINGS)[number];

export function isSpotCandleUnderlying(value: string): value is SpotCandleUnderlying {
  return (SPOT_CANDLE_UNDERLYINGS as readonly string[]).includes(value);
}
