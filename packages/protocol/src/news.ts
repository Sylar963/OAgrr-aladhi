import { z } from 'zod';

export const NEWS_PIN_LIMIT = 3;

export const NewsRelevanceTierSchema = z.enum(['critical', 'watch', 'normal']);
export type NewsRelevanceTier = z.infer<typeof NewsRelevanceTierSchema>;

export const NewsRelevanceSchema = z.object({
  score: z.number().min(0).max(100),
  tier: NewsRelevanceTierSchema,
  tags: z.array(z.string()),
  pinId: z.string().nullable(),
  // Same story as an earlier headline or pin with nothing new in it: the market already knows.
  repeat: z.boolean(),
});
export type NewsRelevance = z.infer<typeof NewsRelevanceSchema>;

export const NewsPinSchema = z.object({
  id: z.string().min(1),
  text: z.string(),
  url: z.string(),
  handle: z.string().nullable(),
  timestamp: z.number(),
  pinnedAt: z.number(),
});
export type NewsPin = z.infer<typeof NewsPinSchema>;

export const NewsPinsResponseSchema = z.object({
  pins: z.array(NewsPinSchema).max(NEWS_PIN_LIMIT),
  max: z.number().int(),
  canEdit: z.boolean(),
});
export type NewsPinsResponse = z.infer<typeof NewsPinsResponseSchema>;

export const PinNewsRequestSchema = z.object({
  id: z.string().min(1).max(128),
});
export type PinNewsRequest = z.infer<typeof PinNewsRequestSchema>;
