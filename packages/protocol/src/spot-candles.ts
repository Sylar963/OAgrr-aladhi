import { z } from 'zod';

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

/**
 * Underlyings charted from real spot markets, aggregated across venues. The
 * rest of SPOT_CANDLE_UNDERLYINGS (equities, indexes, commodities) still chart
 * Hyperliquid perps through /spot-candles.
 */
export const AGGREGATED_SPOT_UNDERLYINGS = [
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
  'XAUT',
] as const satisfies readonly SpotCandleUnderlying[];

export type AggregatedSpotUnderlying = (typeof AGGREGATED_SPOT_UNDERLYINGS)[number];

export function isAggregatedSpotUnderlying(value: string): value is AggregatedSpotUnderlying {
  return (AGGREGATED_SPOT_UNDERLYINGS as readonly string[]).includes(value);
}

const AggregatedSpotCandleSchema = z.object({
  timestamp: z.number(),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  /** Base-asset volume summed across the contributing venues. */
  volume: z.number(),
  /** Venues with a bar in this bucket. */
  venues: z.number(),
});
export type AggregatedSpotCandle = z.infer<typeof AggregatedSpotCandleSchema>;

export const SpotCandleWsMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('bar'), candle: AggregatedSpotCandleSchema }),
  z.object({ type: z.literal('error'), message: z.string() }),
]);
export type SpotCandleWsMessage = z.infer<typeof SpotCandleWsMessageSchema>;
