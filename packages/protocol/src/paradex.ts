import { z } from 'zod';

export const ParadexAccountSummarySchema = z.object({
  venueAccount: z.string().min(1).optional(),
  equityUsd: z.number().finite(),
  freeCollateralUsd: z.number().finite().nullable(),
  initialMarginUsd: z.number().finite().nullable(),
  maintenanceMarginUsd: z.number().finite().nullable(),
  settlementAsset: z.string().nullable(),
  updatedAt: z.number().int().nonnegative().nullable(),
  fetchedAt: z.number().int().nonnegative(),
});
export type ParadexAccountSummary = z.infer<typeof ParadexAccountSummarySchema>;

export const ParadexAccountResponseSchema = ParadexAccountSummarySchema.extend({
  accountId: z.string(),
  venue: z.literal('paradex'),
});

export const ParadexRfqSchema = z.object({
  id: z.string(),
  state: z.string(),
  quantity: z.number().finite().positive(),
  filledQuantity: z.number().finite().nonnegative().nullable(),
  createdAt: z.number().int().nonnegative().nullable(),
  expiresAt: z.number().int().nonnegative().nullable(),
  legs: z.array(
    z.object({
      market: z.string(),
      side: z.enum(['BUY', 'SELL']),
      ratio: z.number().finite().positive(),
      price: z.number().finite().nullable(),
    }),
  ),
  quote: z
    .object({
      bidPrice: z.number().finite().nullable(),
      askPrice: z.number().finite().nullable(),
      bidQuantity: z.number().finite().nonnegative().nullable(),
      askQuantity: z.number().finite().nonnegative().nullable(),
      markPrice: z.number().finite().nullable(),
      createdAt: z.number().int().nonnegative().nullable(),
      fetchedAt: z.number().int().nonnegative(),
    })
    .nullable(),
});
export type ParadexRfq = z.infer<typeof ParadexRfqSchema>;

export const ParadexRfqsResponseSchema = z.object({
  accountId: z.string(),
  venue: z.literal('paradex'),
  fetchedAt: z.number().int().nonnegative(),
  next: z.string().nullable(),
  rfqs: z.array(ParadexRfqSchema),
});
export type ParadexRfqsResponse = z.infer<typeof ParadexRfqsResponseSchema>;
