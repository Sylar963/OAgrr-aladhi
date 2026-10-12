import { z } from 'zod';

/** One ticker's move vs its previous regular-session close. Fractions, not percent. */
export const TradfiSectorQuoteSchema = z.object({
  symbol: z.string().min(1),
  label: z.string().min(1),
  last: z.number().nullable(),
  prevClose: z.number().nullable(),
  change: z.number().nullable(),
  /** True when the ticker's option chain is loaded, so the Chain page can open it. */
  hasOptions: z.boolean(),
});
export type TradfiSectorQuote = z.infer<typeof TradfiSectorQuoteSchema>;

export const TradfiSectorBasketSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** 1-based rank by mean move; null when no member has a move yet. */
  rank: z.number().int().positive().nullable(),
  mean: z.number().nullable(),
  median: z.number().nullable(),
  green: z.number().int().nonnegative(),
  priced: z.number().int().nonnegative(),
  /** Sorted by move, best first; unpriced members last. */
  members: z.array(TradfiSectorQuoteSchema),
});
export type TradfiSectorBasket = z.infer<typeof TradfiSectorBasketSchema>;

/** GET /sectors on the TradFi service. Baskets are sorted by `rank`. */
export const TradfiSectorsResponseSchema = z.object({
  asOf: z.number().int().nonnegative().nullable(),
  /** ISO date of the session the moves are measured against. */
  prevCloseDate: z.string().nullable(),
  tape: z.array(TradfiSectorQuoteSchema),
  baskets: z.array(TradfiSectorBasketSchema),
});
export type TradfiSectorsResponse = z.infer<typeof TradfiSectorsResponseSchema>;
