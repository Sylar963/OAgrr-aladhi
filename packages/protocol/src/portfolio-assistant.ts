import { z } from 'zod';

import { PortfolioSourceSchema } from './portfolio.js';

export const PortfolioAssistantFeatureKeySchema = z.literal('portfolio_assistant_beta');
export type PortfolioAssistantFeatureKey = z.infer<typeof PortfolioAssistantFeatureKeySchema>;

export const PortfolioAssistantAccessSchema = z.object({
  enabled: z.boolean(),
  reason: z.enum([
    'entitled',
    'invite_required',
    'feature_disabled',
    'persistence_unavailable',
    'provider_unavailable',
  ]),
  expiresAt: z.number().int().nonnegative().nullable(),
  dailyQuestionLimit: z.number().int().positive().nullable(),
  dailyQuestionsUsed: z.number().int().nonnegative().nullable(),
});
export type PortfolioAssistantAccess = z.infer<typeof PortfolioAssistantAccessSchema>;

export const RedeemPortfolioAssistantInviteRequestSchema = z.object({
  code: z.string().trim().min(12).max(128),
});
export type RedeemPortfolioAssistantInviteRequest = z.infer<
  typeof RedeemPortfolioAssistantInviteRequestSchema
>;

export const PortfolioAssistantThreadSchema = z.object({
  threadId: z.string().uuid(),
  source: PortfolioSourceSchema,
  underlying: z.string().min(1).nullable(),
  title: z.string().min(1).max(120),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});
export type PortfolioAssistantThread = z.infer<typeof PortfolioAssistantThreadSchema>;

export const CreatePortfolioAssistantThreadRequestSchema = z.object({
  source: PortfolioSourceSchema,
  underlying: z.string().trim().min(1).max(32).nullable(),
});
export type CreatePortfolioAssistantThreadRequest = z.infer<
  typeof CreatePortfolioAssistantThreadRequestSchema
>;

export const PortfolioAssistantThreadListSchema = z.object({
  threads: z.array(PortfolioAssistantThreadSchema),
});
export type PortfolioAssistantThreadList = z.infer<typeof PortfolioAssistantThreadListSchema>;

export const PortfolioAssistantMessageStatusSchema = z.enum([
  'complete',
  'streaming',
  'cancelled',
  'failed',
]);
export type PortfolioAssistantMessageStatus = z.infer<typeof PortfolioAssistantMessageStatusSchema>;

export const PortfolioAssistantMessageSchema = z.object({
  messageId: z.string().uuid(),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  status: PortfolioAssistantMessageStatusSchema,
  portfolioGeneratedAt: z.number().int().nonnegative().nullable(),
  createdAt: z.number().int().nonnegative(),
});
export type PortfolioAssistantMessage = z.infer<typeof PortfolioAssistantMessageSchema>;

export const PortfolioAssistantMessagePageSchema = z.object({
  messages: z.array(PortfolioAssistantMessageSchema),
  nextCursor: z.string().min(1).nullable(),
});
export type PortfolioAssistantMessagePage = z.infer<typeof PortfolioAssistantMessagePageSchema>;

export const SendPortfolioAssistantMessageRequestSchema = z.object({
  clientMessageId: z.string().uuid(),
  message: z.string().trim().min(1).max(4_000),
  forwardDays: z.number().int().min(0).max(365),
});
export type SendPortfolioAssistantMessageRequest = z.infer<
  typeof SendPortfolioAssistantMessageRequestSchema
>;

export const PortfolioAssistantStreamErrorCodeSchema = z.enum([
  'assistant_not_enabled',
  'daily_limit_reached',
  'concurrent_request',
  'thread_not_found',
  'portfolio_unavailable',
  'portfolio_stale',
  'provider_unavailable',
  'provider_allowance_exhausted',
  'provider_timeout',
  'invalid_provider_response',
  'request_cancelled',
  'internal_error',
]);
export type PortfolioAssistantStreamErrorCode = z.infer<
  typeof PortfolioAssistantStreamErrorCodeSchema
>;

export const PortfolioAssistantStreamEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('message_started'),
    assistantMessageId: z.string().uuid(),
    portfolioGeneratedAt: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal('text_delta'),
    assistantMessageId: z.string().uuid(),
    delta: z.string().min(1),
  }),
  z.object({
    type: z.literal('usage'),
    inputTokens: z.number().int().nonnegative().nullable(),
    cachedInputTokens: z.number().int().nonnegative().nullable(),
    outputTokens: z.number().int().nonnegative().nullable(),
  }),
  z.object({ type: z.literal('message_completed'), assistantMessageId: z.string().uuid() }),
  z.object({ type: z.literal('message_cancelled'), assistantMessageId: z.string().uuid() }),
  z.object({
    type: z.literal('error'),
    code: PortfolioAssistantStreamErrorCodeSchema,
    message: z.string(),
    retryable: z.boolean(),
  }),
]);
export type PortfolioAssistantStreamEvent = z.infer<typeof PortfolioAssistantStreamEventSchema>;

export const PortfolioAssistantErrorResponseSchema = z.object({
  error: z.string().min(1),
  message: z.string().min(1),
  retryable: z.boolean(),
});
export type PortfolioAssistantErrorResponse = z.infer<typeof PortfolioAssistantErrorResponseSchema>;

export const PortfolioAssistantMemoryCategorySchema = z.enum([
  'risk_budget',
  'preferred_structures',
  'experience_level',
  'explanation_style',
  'venues',
  'goals',
  'explicit_note',
]);
export type PortfolioAssistantMemoryCategory = z.infer<
  typeof PortfolioAssistantMemoryCategorySchema
>;

export const PortfolioAssistantMemoryItemSchema = z.object({
  id: z.string().min(1).max(64),
  text: z.string().min(1).max(200),
  category: PortfolioAssistantMemoryCategorySchema,
  sourceThreadId: z.string().uuid().nullable(),
  updatedAt: z.number().int().nonnegative(),
});
export type PortfolioAssistantMemoryItem = z.infer<typeof PortfolioAssistantMemoryItemSchema>;

export const PortfolioAssistantMemorySchema = z.object({
  items: z.array(PortfolioAssistantMemoryItemSchema).max(12),
  updatedAt: z.number().int().nonnegative().nullable(),
  lastDistilledAt: z.number().int().nonnegative().nullable(),
});
export type PortfolioAssistantMemory = z.infer<typeof PortfolioAssistantMemorySchema>;

export const PortfolioAssistantFeedbackVoteSchema = z.enum(['up', 'down']);
export type PortfolioAssistantFeedbackVote = z.infer<typeof PortfolioAssistantFeedbackVoteSchema>;

export const PortfolioAssistantFeedbackReasonSchema = z.enum([
  'wrong_numbers',
  'did_not_answer',
  'too_long',
  'refused',
  'other',
]);
export type PortfolioAssistantFeedbackReason = z.infer<
  typeof PortfolioAssistantFeedbackReasonSchema
>;

export const PORTFOLIO_ASSISTANT_FEEDBACK_NOTE_MAX_CHARS = 200;

export const SubmitPortfolioAssistantFeedbackRequestSchema = z
  .discriminatedUnion('vote', [
    z.object({ vote: z.literal('up') }).strict(),
    z
      .object({
        vote: z.literal('down'),
        reasons: z.array(PortfolioAssistantFeedbackReasonSchema).max(5).default([]),
        note: z.string().trim().max(PORTFOLIO_ASSISTANT_FEEDBACK_NOTE_MAX_CHARS).optional(),
      })
      .strict(),
  ])
  .superRefine((value, context) => {
    if (value.vote === 'down' && new Set(value.reasons).size !== value.reasons.length) {
      context.addIssue({ code: 'custom', message: 'Reasons must be unique.', path: ['reasons'] });
    }
  });
export type SubmitPortfolioAssistantFeedbackRequest = z.input<
  typeof SubmitPortfolioAssistantFeedbackRequestSchema
>;

export const PortfolioAssistantFeedbackSchema = z.object({
  messageId: z.string().uuid(),
  vote: PortfolioAssistantFeedbackVoteSchema,
  reasons: z.array(PortfolioAssistantFeedbackReasonSchema),
  note: z.string().max(PORTFOLIO_ASSISTANT_FEEDBACK_NOTE_MAX_CHARS).nullable(),
  updatedAt: z.number().int().nonnegative(),
});
export type PortfolioAssistantFeedback = z.infer<typeof PortfolioAssistantFeedbackSchema>;

export const PortfolioAssistantFeedbackListSchema = z.object({
  feedback: z.array(PortfolioAssistantFeedbackSchema),
});
export type PortfolioAssistantFeedbackList = z.infer<typeof PortfolioAssistantFeedbackListSchema>;
