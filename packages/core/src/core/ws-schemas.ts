import { z } from 'zod';
import { VENUE_IDS, type VenueId } from '../types/common.js';

const VenueIdSchema = z.enum(VENUE_IDS as unknown as [string, ...string[]])
  .transform((v) => v as VenueId);

export const WsSubscriptionRequestSchema = z.object({
  underlying: z.string().min(1),
  expiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  venues: z.array(VenueIdSchema).min(1),
});

export const ClientSubscribeSchema = z.object({
  type: z.literal('subscribe'),
  subscriptionId: z.string().min(1),
  request: WsSubscriptionRequestSchema,
});

export const ClientUnsubscribeSchema = z.object({
  type: z.literal('unsubscribe'),
});

export const ClientWsMessageSchema = z.discriminatedUnion('type', [
  ClientSubscribeSchema,
  ClientUnsubscribeSchema,
]);
