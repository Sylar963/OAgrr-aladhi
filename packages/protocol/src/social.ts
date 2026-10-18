import { z } from 'zod';

export const CHAT_MESSAGE_MAX_CHARS = 500;
export const CHAT_GLOBAL_ROOM = 'global';

/** Venues whose private connection reports positions and account equity history. */
export const SocialVenueSchema = z.enum(['derive', 'thalex', 'paradex']);
export type SocialVenue = z.infer<typeof SocialVenueSchema>;

export const SocialVenueConnectionSchema = z.object({
  venue: SocialVenueSchema,
  connected: z.boolean(),
});
export type SocialVenueConnection = z.infer<typeof SocialVenueConnectionSchema>;

/**
 * `handle` mirrors the account username; it cannot be set through this API. `venues` lists the
 * venue accounts the user has connected, one of which is broadcast while on the leaderboard.
 */
export const SocialProfileDtoSchema = z.object({
  handle: z.string().nullable(),
  leaderboardVisible: z.boolean(),
  broadcastVenue: SocialVenueSchema.nullable(),
  consentedAt: z.string().datetime().nullable(),
  venues: z.array(SocialVenueConnectionSchema),
});
export type SocialProfileDto = z.infer<typeof SocialProfileDtoSchema>;

/**
 * Joining publishes the username plus the chosen venue account's open positions, closing fills and
 * equity history. Omitting `broadcastVenue` keeps the current choice.
 */
export const UpdateSocialProfileRequestSchema = z
  .object({
    leaderboardVisible: z.boolean(),
    broadcastVenue: SocialVenueSchema.nullable().optional(),
  })
  .strict();
export type UpdateSocialProfileRequest = z.infer<typeof UpdateSocialProfileRequestSchema>;

export const LeaderboardPeriodSchema = z.enum(['all', '30d', '7d']);
export type LeaderboardPeriod = z.infer<typeof LeaderboardPeriodSchema>;

export const LeaderboardQuerySchema = z.object({
  period: LeaderboardPeriodSchema.default('all'),
});

export const LeaderboardEntryDtoSchema = z.object({
  rank: z.number().int().positive(),
  handle: z.string(),
  venue: SocialVenueSchema,
  /** Latest account equity the venue reported. */
  equityUsd: z.number(),
  equityAsOf: z.string().datetime(),
  pnlUsd: z.number(),
  /** Fractional equity change over the period (0.12 = +12%); deposits and withdrawals count. */
  returnPct: z.number(),
  /** Start of the equity history the period was measured from. */
  since: z.string().datetime(),
  /** When the trader first joined the leaderboard. */
  sharingSince: z.string().datetime(),
  openPositions: z.number().int().nonnegative(),
  isMe: z.boolean(),
});
export type LeaderboardEntryDto = z.infer<typeof LeaderboardEntryDtoSchema>;

export const LeaderboardResponseSchema = z.object({
  period: LeaderboardPeriodSchema,
  generatedAt: z.string().datetime(),
  entries: z.array(LeaderboardEntryDtoSchema),
});
export type LeaderboardResponse = z.infer<typeof LeaderboardResponseSchema>;

export const ChatMessageDtoSchema = z.object({
  id: z.string(),
  alias: z.string(),
  isAnon: z.boolean(),
  body: z.string(),
  createdAt: z.string().datetime(),
  mine: z.boolean(),
});
export type ChatMessageDto = z.infer<typeof ChatMessageDtoSchema>;

export const PublicPositionDtoSchema = z.object({
  underlying: z.string(),
  expiry: z.string(),
  strike: z.number(),
  optionRight: z.enum(['call', 'put']),
  netQuantity: z.number(),
  avgEntryPriceUsd: z.number(),
  markPriceUsd: z.number().nullable(),
  unrealizedPnlUsd: z.number().nullable(),
});
export type PublicPositionDto = z.infer<typeof PublicPositionDtoSchema>;

/** A venue fill that reduced a position and realized PnL. */
export const PublicClosedTradeDtoSchema = z.object({
  id: z.string(),
  underlying: z.string(),
  expiry: z.string(),
  strike: z.number(),
  optionRight: z.enum(['call', 'put']),
  direction: z.enum(['buy', 'sell']),
  amount: z.number(),
  priceUsd: z.number(),
  realizedPnlUsd: z.number(),
  feeUsd: z.number().nullable(),
  closedAt: z.string().datetime(),
});
export type PublicClosedTradeDto = z.infer<typeof PublicClosedTradeDtoSchema>;

export const EquityPointDtoSchema = z.object({
  ts: z.string().datetime(),
  equityUsd: z.number(),
});
export type EquityPointDto = z.infer<typeof EquityPointDtoSchema>;

export const TraderLiveDtoSchema = z.object({
  handle: z.string(),
  venue: SocialVenueSchema,
  /** Latest account equity the venue reported; pnl and return run from the first history point. */
  equityUsd: z.number(),
  equityAsOf: z.string().datetime(),
  pnlUsd: z.number(),
  returnPct: z.number(),
  openPositions: z.array(PublicPositionDtoSchema),
  generatedAt: z.string().datetime(),
});
export type TraderLiveDto = z.infer<typeof TraderLiveDtoSchema>;

/** Full view of a leaderboard trader: sent on watch and whenever their book changes. */
export const PublicTraderDtoSchema = TraderLiveDtoSchema.extend({
  isMe: z.boolean(),
  /** First funded equity close in the venue history. */
  startedAt: z.string().datetime(),
  /** When the trader first joined the leaderboard. */
  sharingSince: z.string().datetime(),
  /** Daily account equity closes from the venue, oldest first. */
  equityHistory: z.array(EquityPointDtoSchema),
  closedTrades: z.array(PublicClosedTradeDtoSchema),
  /** False when the venue does not report fill history (Paradex). */
  closedTradesAvailable: z.boolean(),
});
export type PublicTraderDto = z.infer<typeof PublicTraderDtoSchema>;

export const ChatClientMessageSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('send'),
      body: z.string().trim().min(1).max(CHAT_MESSAGE_MAX_CHARS),
      anon: z.boolean(),
    })
    .strict(),
  z.object({ type: z.literal('delete'), id: z.string().min(1).max(64) }).strict(),
  z.object({ type: z.literal('watch'), handle: z.string().min(1).max(64) }).strict(),
  z.object({ type: z.literal('unwatch') }).strict(),
]);
export type ChatClientMessage = z.infer<typeof ChatClientMessageSchema>;

export const ChatServerMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('hello'),
    room: z.string(),
    online: z.number().int().nonnegative(),
    handle: z.string().nullable(),
    anonAlias: z.string(),
    mutedUntil: z.string().datetime().nullable(),
  }),
  z.object({ type: z.literal('history'), messages: z.array(ChatMessageDtoSchema) }),
  z.object({ type: z.literal('message'), message: ChatMessageDtoSchema }),
  z.object({ type: z.literal('deleted'), id: z.string() }),
  z.object({ type: z.literal('presence'), online: z.number().int().nonnegative() }),
  z.object({ type: z.literal('trader'), trader: PublicTraderDtoSchema }),
  z.object({ type: z.literal('trader_live'), live: TraderLiveDtoSchema }),
  z.object({
    type: z.literal('trader_unavailable'),
    handle: z.string(),
    /** `waiting`: still on the leaderboard but their venue account is not connected. */
    reason: z.enum(['left', 'waiting']),
  }),
  z.object({ type: z.literal('error'), code: z.string(), message: z.string() }),
]);
export type ChatServerMessage = z.infer<typeof ChatServerMessageSchema>;

export const ChatModerationRequestSchema = z
  .object({
    action: z.enum(['delete', 'mute', 'ban', 'unban']),
    minutes: z.number().int().positive().max(525_600).optional(),
    reason: z.string().trim().max(200).optional(),
  })
  .strict();
export type ChatModerationRequest = z.infer<typeof ChatModerationRequestSchema>;
