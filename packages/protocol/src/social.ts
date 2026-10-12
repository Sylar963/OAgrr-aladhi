import { z } from 'zod';

export const SOCIAL_HANDLE_PATTERN = /^[A-Za-z0-9_]{3,20}$/;
export const CHAT_MESSAGE_MAX_CHARS = 500;
export const CHAT_GLOBAL_ROOM = 'global';

export const SocialHandleSchema = z
  .string()
  .trim()
  .regex(SOCIAL_HANDLE_PATTERN, 'Handle must be 3–20 letters, digits or underscores')
  .refine((handle) => !/^(anon|admin|mod|system)/i.test(handle), 'Handle is reserved');

export const SocialProfileDtoSchema = z.object({
  handle: z.string().nullable(),
  leaderboardVisible: z.boolean(),
});
export type SocialProfileDto = z.infer<typeof SocialProfileDtoSchema>;

export const UpdateSocialProfileRequestSchema = z
  .object({
    handle: SocialHandleSchema.nullable(),
    leaderboardVisible: z.boolean(),
  })
  .strict()
  .refine((value) => !value.leaderboardVisible || value.handle !== null, {
    message: 'A handle is required to appear on the leaderboard',
    path: ['handle'],
  });
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

export const ChatClientMessageSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('send'),
      body: z.string().trim().min(1).max(CHAT_MESSAGE_MAX_CHARS),
      anon: z.boolean(),
    })
    .strict(),
  z.object({ type: z.literal('delete'), id: z.string().min(1).max(64) }).strict(),
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
