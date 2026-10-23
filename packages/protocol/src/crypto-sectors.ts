import { z } from 'zod';

/** One asset's rolling 24h move from its Bybit perp. Fractions, not percent. */
export const CryptoSectorQuoteSchema = z.object({
  symbol: z.string().min(1),
  label: z.string().min(1),
  last: z.number().nullable(),
  change: z.number().nullable(),
  /** Venues listing options on this underlying; empty when there is no chain to open. */
  optionVenues: z.array(z.string()),
});
export type CryptoSectorQuote = z.infer<typeof CryptoSectorQuoteSchema>;

export const CryptoSectorBasketSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** 1-based rank by mean move; null when no member has a move yet. */
  rank: z.number().int().positive().nullable(),
  mean: z.number().nullable(),
  median: z.number().nullable(),
  green: z.number().int().nonnegative(),
  priced: z.number().int().nonnegative(),
  /** Sorted by move, best first; unpriced members last. */
  members: z.array(CryptoSectorQuoteSchema),
});
export type CryptoSectorBasket = z.infer<typeof CryptoSectorBasketSchema>;

/** GET /api/sectors. Baskets are sorted by `rank`. */
export const CryptoSectorsResponseSchema = z.object({
  asOf: z.number().int().nonnegative().nullable(),
  /** Options venues currently connected, the denominator for `optionVenues`. */
  venueCount: z.number().int().nonnegative(),
  tape: z.array(CryptoSectorQuoteSchema),
  baskets: z.array(CryptoSectorBasketSchema),
});
export type CryptoSectorsResponse = z.infer<typeof CryptoSectorsResponseSchema>;

/** Cross-sector co-movement over one rolling window of 5m Bybit perp bars. */
export const CryptoSectorCorrelationPointSchema = z.object({
  /** End of the window (close time of its last bar). */
  t: z.number().int().nonnegative(),
  /** Mean pairwise correlation of equal-weight sector returns. */
  avgCorr: z.number().nullable(),
  /** Same, after regressing each sector on BTC: co-movement BTC does not explain. */
  residualCorr: z.number().nullable(),
  /** Share of variance on the first principal component (1/k … 1). */
  pc1Share: z.number().nullable(),
  /** Cross-sectional stdev of sector returns over the window, as a fraction. */
  dispersion: z.number().nullable(),
});
export type CryptoSectorCorrelationPoint = z.infer<typeof CryptoSectorCorrelationPointSchema>;

export const CryptoSectorCorrelationSectorSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  corrBtc: z.number().nullable(),
  betaBtc: z.number().nullable(),
  /** Mean pairwise correlation between the basket's own members. */
  intraCorr: z.number().nullable(),
  /** Mean correlation to the other sectors. */
  meanCorr: z.number().nullable(),
  /** (`meanCorr` − market mean correlation) against this sector's own loaded history. */
  gapZ: z.number().nullable(),
  /** Unusually detached from the pack while the market overall is not dispersed. */
  decoupled: z.boolean(),
});
export type CryptoSectorCorrelationSector = z.infer<typeof CryptoSectorCorrelationSectorSchema>;

/** One heatmap window; matrices and `corrBtc` are in `sectorIds` order, null where a sector lacked data. */
export const CryptoSectorCorrelationViewSchema = z.object({
  windowBars: z.number().int().positive(),
  matrix: z.array(z.array(z.number().nullable())),
  /** Partial correlations after removing each sector's BTC beta. */
  residualMatrix: z.array(z.array(z.number().nullable())),
  corrBtc: z.array(z.number().nullable()),
});
export type CryptoSectorCorrelationView = z.infer<typeof CryptoSectorCorrelationViewSchema>;

export const CryptoSectorRegimeSchema = z.enum(['correlated', 'mixed', 'dispersed']);
export type CryptoSectorRegime = z.infer<typeof CryptoSectorRegimeSchema>;

/** GET /api/sectors/correlation. */
export const CryptoSectorCorrelationResponseSchema = z.object({
  asOf: z.number().int().nonnegative().nullable(),
  barSec: z.number().int().positive(),
  windowBars: z.number().int().positive(),
  thresholds: z.object({ correlated: z.number(), dispersed: z.number() }),
  regime: CryptoSectorRegimeSchema.nullable(),
  /** When the current regime began, within the loaded history; null if it spans all of it. */
  regimeSince: z.number().int().nonnegative().nullable(),
  current: CryptoSectorCorrelationPointSchema.nullable(),
  /** avgCorr now minus one hour earlier. */
  change1h: z.number().nullable(),
  /** avgCorr distribution over the loaded history (~3.5 days of windows). */
  baseline: z.object({
    mean: z.number().nullable(),
    std: z.number().nullable(),
    windows: z.number().int().nonnegative(),
  }),
  zScore: z.number().nullable(),
  sectorIds: z.array(z.string()),
  /** Heatmap windows, shortest first; the first matches `windowBars`. */
  views: z.array(CryptoSectorCorrelationViewSchema),
  /** Per-sector stats over the `windowBars` window. */
  sectors: z.array(CryptoSectorCorrelationSectorSchema),
  /** Last 24h, one point per bar. */
  timeline: z.array(CryptoSectorCorrelationPointSchema),
});
export type CryptoSectorCorrelationResponse = z.infer<typeof CryptoSectorCorrelationResponseSchema>;
