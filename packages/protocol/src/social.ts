import { z } from 'zod';

export const CHAT_MESSAGE_MAX_CHARS = 500;
export const CHAT_GLOBAL_ROOM = 'global';

/** `handle` mirrors the account username; it cannot be set through this API. */
export const SocialProfileDtoSchema = z.object({
  handle: z.string().nullable(),
  leaderboardVisible: z.boolean(),
  consentedAt: z.string().datetime().nullable(),
});
export type SocialProfileDto = z.infer<typeof SocialProfileDtoSchema>;

/** Joining publishes the username, live open positions, closed trades and equity history. */
export const UpdateSocialProfileRequestSchema = z
  .object({ leaderboardVisible: z.boolean() })
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
  equityUsd: z.number(),
  pnlUsd: z.number(),
  /** Fractional return over the period (0.12 = +12%). */
  returnPct: z.number(),
  openPositions: z.number().int().nonnegative(),
  /** Open legs without a live mark, valued at entry price. */
  unmarkedPositions: z.number().int().nonnegative(),
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

export const PublicClosedTradeDtoSchema = z.object({
  id: z.string(),
  underlying: z.string(),
  label: z.string(),
  strategyName: z.string(),
  openedAt: z.string(),
  closedAt: z.string().nullable(),
  realizedPnlUsd: z.number(),
  feesUsd: z.number(),
});
export type PublicClosedTradeDto = z.infer<typeof PublicClosedTradeDtoSchema>;

export const EquityPointDtoSchema = z.object({
  ts: z.string().datetime(),
  equityUsd: z.number(),
});
export type EquityPointDto = z.infer<typeof EquityPointDtoSchema>;

export const TraderLiveDtoSchema = z.object({
  handle: z.string(),
  equityUsd: z.number(),
  pnlUsd: z.number(),
  returnPct: z.number(),
  openPositions: z.array(PublicPositionDtoSchema),
  generatedAt: z.string().datetime(),
});
export type TraderLiveDto = z.infer<typeof TraderLiveDtoSchema>;

/** Full view of a leaderboard trader: sent on watch and whenever their book changes. */
export const PublicTraderDtoSchema = TraderLiveDtoSchema.extend({
  isMe: z.boolean(),
  initialCashUsd: z.number(),
  startedAt: z.string().datetime(),
  /** Daily snapshots since the start, oldest first, ending with the live point. */
  equityHistory: z.array(EquityPointDtoSchema),
  closedTrades: z.array(PublicClosedTradeDtoSchema),
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
  z.object({ type: z.literal('trader_unavailable'), handle: z.string() }),
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
