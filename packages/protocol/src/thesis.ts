import { z } from 'zod';

import { PortfolioSourceSchema } from './portfolio.js';

export const THESIS_FLIP_CONFIRMATION = 'I am overriding my thesis';
export const THESIS_MIN_REASON_CHARS = 20;
export const THESIS_MIN_FLIP_REASON_CHARS = 40;
export const THESIS_MAX_TEXT_CHARS = 1000;

const NullableNumber = z.number().nullable();

export const ThesisDirectionSchema = z.enum(['bullish', 'bearish']);
export type ThesisDirection = z.infer<typeof ThesisDirectionSchema>;

export const ThesisClassificationSchema = z.enum(['bullish', 'bearish', 'neutral', 'unknown']);
export type ThesisClassification = z.infer<typeof ThesisClassificationSchema>;

export const ThesisConfirmSecSchema = z.union([z.literal(14400), z.literal(86400)]);
export type ThesisConfirmSec = z.infer<typeof ThesisConfirmSecSchema>;

export const ThesisStateSchema = z.enum([
  'active',
  'invalidated',
  'expired',
  'ended_early',
  'overridden',
  'reversed',
]);
export type ThesisState = z.infer<typeof ThesisStateSchema>;

export const ThesisStatusSchema = z.enum(['INTACT', 'AT_RISK', 'INVALIDATED', 'EXPIRED']);
export type ThesisStatus = z.infer<typeof ThesisStatusSchema>;

export const ThesisMarketContextSchema = z.object({
  capturedAt: z.number(),
  spotUsd: NullableNumber,
  /** DVOL as a fraction (0.45 = 45). */
  dvol: NullableNumber,
  /** ATM IV of the horizon expiry, fraction. */
  atmIv: NullableNumber,
  /** 25Δ call IV minus 25Δ put IV at the horizon expiry, fraction. */
  skew25d: NullableNumber,
  /** Dealer GEX at spot across all expiries, $M per 1% move. */
  netGexUsdMillions: NullableNumber,
});
export type ThesisMarketContext = z.infer<typeof ThesisMarketContextSchema>;

const ExpiryDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const ThesisShareSchema = z.object({
  /** Social user whose username the thesis is published under. */
  userId: z.string().min(1),
  sharedAt: z.number(),
});
export type ThesisShare = z.infer<typeof ThesisShareSchema>;

export const ThesisRecordSchema = z.object({
  id: z.string().uuid(),
  accountId: z.string().min(1),
  underlying: z.string().min(1),
  direction: ThesisDirectionSchema,
  horizonExpiry: ExpiryDateSchema,
  level: z.number().positive(),
  confirmSec: ThesisConfirmSecSchema,
  reason: z.string().min(THESIS_MIN_REASON_CHARS).max(THESIS_MAX_TEXT_CHARS),
  contextAtCreation: ThesisMarketContextSchema,
  linkedSnapshotId: z.string().max(100).nullable(),
  state: ThesisStateSchema,
  createdAt: z.number(),
  endedAt: NullableNumber,
  endNote: z.string().max(THESIS_MAX_TEXT_CHARS).nullable(),
  share: ThesisShareSchema.nullable().default(null),
});
export type ThesisRecord = z.infer<typeof ThesisRecordSchema>;

export const ThesisEventKindSchema = z.enum([
  'created',
  'gate_shown',
  'gate_kept',
  'cooldown_started',
  'cooldown_ended',
  'override',
  'flip_after_wait',
  'flip_detected',
  'flip_logged_late',
  'back_to_thesis',
  'flip_cleared',
  'ended_early',
  'invalidated',
  'expired',
  'level_tightened',
  'shared',
  'unshared',
]);
export type ThesisEventKind = z.infer<typeof ThesisEventKindSchema>;

export const ThesisEventSchema = z.object({
  id: z.string().uuid(),
  thesisId: z.string().uuid(),
  accountId: z.string().min(1),
  kind: ThesisEventKindSchema,
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.number(),
});
export type ThesisEvent = z.infer<typeof ThesisEventSchema>;

export const ThesisCreateRequestSchema = z.object({
  underlying: z.string().min(1).max(32),
  direction: ThesisDirectionSchema,
  horizonExpiry: ExpiryDateSchema,
  level: z.number().positive(),
  confirmSec: ThesisConfirmSecSchema.default(86400),
  reason: z.string().trim().min(THESIS_MIN_REASON_CHARS).max(THESIS_MAX_TEXT_CHARS),
  linkedSnapshotId: z.string().max(100).nullable().optional(),
  /** Publish on the Social feed under the account username. A flip keeps the old thesis's choice unless false. */
  share: z.boolean().optional(),
});
export type ThesisCreateRequest = z.input<typeof ThesisCreateRequestSchema>;

export const ThesisFlipRequestSchema = z.object({
  reason: z.string().trim().min(THESIS_MIN_FLIP_REASON_CHARS).max(THESIS_MAX_TEXT_CHARS),
  confirmation: z.string().optional(),
  /** Set when logging a flip the held-book monitor already detected. */
  late: z.boolean().optional(),
  newThesis: ThesisCreateRequestSchema.omit({ underlying: true }),
});
export type ThesisFlipRequest = z.input<typeof ThesisFlipRequestSchema>;

export const ThesisEndRequestSchema = z.object({
  note: z.string().trim().max(THESIS_MAX_TEXT_CHARS).optional(),
});

export const ThesisTightenRequestSchema = z.object({ level: z.number().positive() });

export const ThesisShareRequestSchema = z.object({ shared: z.boolean() });
export type ThesisShareRequest = z.infer<typeof ThesisShareRequestSchema>;

export const ThesisDiffKeySchema = z.enum(['spot', 'dvol', 'atmIv', 'skew25d', 'netGex']);
export type ThesisDiffKey = z.infer<typeof ThesisDiffKeySchema>;

export const ThesisDiffRowSchema = z.object({
  key: ThesisDiffKeySchema,
  before: NullableNumber,
  after: NullableNumber,
  /** Null when either side is missing; such rows are not counted. */
  material: z.boolean().nullable(),
});
export type ThesisDiffRow = z.infer<typeof ThesisDiffRowSchema>;

export const ThesisDiffSchema = z.object({
  rows: z.array(ThesisDiffRowSchema),
  materialCount: z.number().int(),
  comparedCount: z.number().int(),
});
export type ThesisDiff = z.infer<typeof ThesisDiffSchema>;

export const ThesisStatusDetailSchema = z.object({
  status: ThesisStatusSchema,
  spotUsd: NullableNumber,
  /** Signed distance from spot to the level as a fraction of spot; positive means room left. */
  roomPct: NullableNumber,
  atRiskBandUsd: NullableNumber,
  msToHorizon: z.number(),
  /** Open time of the confirmation candle that closed beyond the level. */
  firedCandleTs: NullableNumber,
});
export type ThesisStatusDetail = z.infer<typeof ThesisStatusDetailSchema>;

export const ThesisCooldownSchema = z.object({
  kind: z.enum(['wait', 'reversal']),
  startedAt: z.number(),
  endsAt: z.number(),
  completed: z.boolean(),
});
export type ThesisCooldown = z.infer<typeof ThesisCooldownSchema>;

export const ThesisPendingFlipSchema = z.object({
  detectedAt: z.number(),
  source: PortfolioSourceSchema,
  classification: ThesisClassificationSchema,
  backToThesis: z.boolean(),
});
export type ThesisPendingFlip = z.infer<typeof ThesisPendingFlipSchema>;

export const ThesisViewSchema = z.object({
  thesis: ThesisRecordSchema,
  status: ThesisStatusDetailSchema,
  diff: ThesisDiffSchema.nullable(),
  cooldown: ThesisCooldownSchema.nullable(),
  pendingFlip: ThesisPendingFlipSchema.nullable(),
  /** True once a wait finished, so a flip no longer needs the typed confirmation. */
  waitCompleted: z.boolean(),
});
export type ThesisView = z.infer<typeof ThesisViewSchema>;

export const ThesisListResponseSchema = z.object({
  active: z.array(ThesisViewSchema),
  /** Theses ended early whose reversal cooldown is still running. */
  reversalCooldowns: z.array(ThesisViewSchema),
});
export type ThesisListResponse = z.infer<typeof ThesisListResponseSchema>;

export const ThesisGateLegSchema = z.object({
  expiry: ExpiryDateSchema,
  strike: z.number().positive(),
  optionRight: z.enum(['call', 'put']),
  side: z.enum(['buy', 'sell']),
  /** Underlying units (contracts × multiplier). */
  size: z.number().positive(),
  /** Premium per underlying unit, USD. */
  premiumUsd: z.number().min(0),
  iv: z.number().positive().nullable(),
});
export type ThesisGateLeg = z.infer<typeof ThesisGateLegSchema>;

export const ThesisGateCheckRequestSchema = z.object({
  underlying: z.string().min(1).max(32),
  legs: z.array(ThesisGateLegSchema).min(1).max(40),
  combineWith: PortfolioSourceSchema.optional(),
});
export type ThesisGateCheckRequest = z.infer<typeof ThesisGateCheckRequestSchema>;

export const ThesisStructureClassSchema = z.object({
  classification: ThesisClassificationSchema,
  bias: NullableNumber,
  upPnlUsd: NullableNumber,
  downPnlUsd: NullableNumber,
  movePct: NullableNumber,
  note: z.string().nullable(),
});
export type ThesisStructureClass = z.infer<typeof ThesisStructureClassSchema>;

export const ThesisGateReasonSchema = z.enum([
  'no_thesis',
  'rule_fired',
  'expired',
  'same_direction',
  'neutral',
  'opposite',
  'reversal_cooldown',
  'unknown',
]);
export type ThesisGateReason = z.infer<typeof ThesisGateReasonSchema>;

export const ThesisGateCheckResponseSchema = z.object({
  decision: z.enum(['pass', 'gate', 'unknown']),
  reason: ThesisGateReasonSchema,
  proposed: ThesisStructureClassSchema,
  combined: ThesisStructureClassSchema.nullable(),
  /** Set when the held book could not be combined or was empty. */
  heldBookNote: z.string().nullable(),
  view: ThesisViewSchema.nullable(),
});
export type ThesisGateCheckResponse = z.infer<typeof ThesisGateCheckResponseSchema>;

/** A thesis its author shared on the Social feed. */
export const PublicThesisDtoSchema = z.object({
  id: z.string().uuid(),
  handle: z.string(),
  isMe: z.boolean(),
  underlying: z.string(),
  direction: ThesisDirectionSchema,
  horizonExpiry: ExpiryDateSchema,
  level: z.number().positive(),
  confirmSec: ThesisConfirmSecSchema,
  reason: z.string(),
  state: ThesisStateSchema,
  /** Live rule status while active; null once the thesis ended. */
  status: ThesisStatusSchema.nullable(),
  roomPct: NullableNumber,
  spotAtCreation: NullableNumber,
  spotUsd: NullableNumber,
  createdAt: z.number(),
  sharedAt: z.number(),
  endedAt: NullableNumber,
  endNote: z.string().nullable(),
});
export type PublicThesisDto = z.infer<typeof PublicThesisDtoSchema>;

export const PublicThesisFeedSchema = z.object({
  generatedAt: z.number(),
  theses: z.array(PublicThesisDtoSchema),
});
export type PublicThesisFeed = z.infer<typeof PublicThesisFeedSchema>;
