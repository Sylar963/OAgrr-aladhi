import { z } from 'zod';

export const NewsObservationSchema = z.object({
  id: z.string().min(1).max(256),
  text: z.string(),
  url: z.string(),
  source: z.string(),
  handle: z.string().nullable(),
  ruleTag: z.string().nullable(),
  timestamp: z.number().int().nonnegative(),
  classification: z.enum(['GOOD', 'BAD', 'unclassified']),
  upstreamCreatedAt: z.string().datetime().nullable(),
  upstreamHeadlineTimestamp: z.string().nullable().optional(),
});
export type NewsObservation = z.infer<typeof NewsObservationSchema>;

export const NewsDeliveryEventSchema = z.object({
  cursor: z.string().regex(/^[a-f0-9-]+:[0-9]+$/),
  sequence: z.number().int().positive(),
  receivedAt: z.number().int().nonnegative(),
  firstReceivedAt: z.number().int().nonnegative(),
  revision: z.number().int().positive(),
  changedFields: z.array(z.string()).optional(),
  backfill: z.boolean().default(false),
  observation: NewsObservationSchema,
});
export type NewsDeliveryEvent = z.infer<typeof NewsDeliveryEventSchema>;

export const NewsDeliveryQuerySchema = z.object({
  after: z
    .string()
    .max(100)
    .regex(/^[a-f0-9-]+:[0-9]+$/)
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export const NewsDeliveryPageSchema = z.object({
  events: z.array(NewsDeliveryEventSchema),
  nextCursor: z.string(),
  hasMore: z.boolean(),
  oldestCursor: z.string().nullable(),
});

export const NewsFeedHealthSchema = z.object({
  ready: z.boolean(),
  lastAttemptAt: z.number().nullable(),
  lastSuccessAt: z.number().nullable(),
  lastSuccessAgeMs: z.number().nullable(),
  pollIntervalMs: z.number(),
  consecutiveErrors: z.number(),
  errors: z.number(),
  lastError: z.string().nullable(),
  saturatedPolls: z.number(),
  unclassifiedSince: z.number().nullable(),
  upstreamLimit: z.number(),
  delivery: z.literal('polled-latest-window'),
  completeHistoryGuaranteed: z.literal(false),
});
export const NewsEventsResponseSchema = NewsDeliveryPageSchema.extend({
  health: NewsFeedHealthSchema.nullable(),
  generatedAt: z.number(),
});
export const NewsStreamMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('subscribed'),
    cursor: z.string(),
    health: NewsFeedHealthSchema.nullable(),
  }),
  z.object({ type: z.literal('events'), page: NewsEventsResponseSchema }),
  z.object({
    type: z.literal('heartbeat'),
    cursor: z.string(),
    health: NewsFeedHealthSchema.nullable(),
  }),
  z.object({
    type: z.literal('error'),
    code: z.string(),
    oldestCursor: z.string().nullable(),
    latestCursor: z.string(),
  }),
]);
