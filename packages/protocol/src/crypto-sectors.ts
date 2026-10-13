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
