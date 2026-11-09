import { z } from 'zod';
import { VenueEnvironmentSchema } from './venue-credentials.js';

export const ThalexAccountResponseSchema = z.object({
  accountId: z.string(),
  venue: z.literal('thalex'),
  environment: VenueEnvironmentSchema,
  equityUsd: z.number().finite(),
  freeMarginUsd: z.number().finite().nullable(),
  initialMarginUsd: z.number().finite().nullable(),
  unpricedAssets: z.array(z.string()),
  updatedAt: z.number().int().nonnegative(),
});
export type ThalexAccountResponse = z.infer<typeof ThalexAccountResponseSchema>;
