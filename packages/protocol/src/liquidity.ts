import { z } from 'zod';

export const LIQUIDITY_DEPTH_BANDS_PCT = [0.5, 1, 2, 5] as const;
export const LIQUIDITY_LADDER_LEVELS = 20;
export const LIQUIDITY_MAX_SIZE = 1000;

export const LiquidityQuerySchema = z.object({
  instrument: z.string().trim().min(1).max(200),
  side: z.enum(['buy', 'sell']),
  size: z.coerce.number().positive().max(LIQUIDITY_MAX_SIZE),
});
export type LiquidityQuery = z.infer<typeof LiquidityQuerySchema>;

export const LiquidityLevelSchema = z.object({
  price: z.number(),
  amount: z.number(),
  outrightAmount: z.number(),
});
export type LiquidityLevel = z.infer<typeof LiquidityLevelSchema>;

export const LiquidityFillSchema = z.object({
  side: z.enum(['buy', 'sell']),
  requested: z.number(),
  filled: z.number(),
  fullyFilled: z.boolean(),
  vwap: z.number().nullable(),
  worstPrice: z.number().nullable(),
  notional: z.number(),
  levelsUsed: z.number().int(),
  slippageVsTouch: z.number().nullable(),
  slippageVsTouchPct: z.number().nullable(),
  slippageVsMark: z.number().nullable(),
  slippageVsMarkPct: z.number().nullable(),
});
export type LiquidityFill = z.infer<typeof LiquidityFillSchema>;

export const LiquidityDepthBandSchema = z.object({
  pct: z.number(),
  bidAmount: z.number(),
  askAmount: z.number(),
  bidNotional: z.number(),
  askNotional: z.number(),
});
export type LiquidityDepthBand = z.infer<typeof LiquidityDepthBandSchema>;

export const LiquidityResponseSchema = z.object({
  venue: z.literal('thalex'),
  instrument: z.string(),
  /** USD per unit; quantities are in the underlying coin. */
  priceUnit: z.literal('usd'),
  quantityUnit: z.literal('base'),
  state: z.enum(['uninitialized', 'synced', 'unsynchronized']),
  crossed: z.boolean(),
  asOf: z.number(),
  bookAgeMs: z.number(),
  exchangeTs: z.number().nullable(),
  mark: z
    .object({
      markPrice: z.number(),
      indexPrice: z.number().nullable(),
      delta: z.number().nullable(),
      iv: z.number().nullable(),
      ageMs: z.number(),
    })
    .nullable(),
  bestBid: z.number().nullable(),
  bestAsk: z.number().nullable(),
  spread: z.number().nullable(),
  spreadPct: z.number().nullable(),
  fill: LiquidityFillSchema,
  depth: z.array(LiquidityDepthBandSchema),
  bids: z.array(LiquidityLevelSchema),
  asks: z.array(LiquidityLevelSchema),
});
export type LiquidityResponse = z.infer<typeof LiquidityResponseSchema>;

export const LIQUIDITY_CLOSE_MAX_LEGS = 24;

// One leg per `leg` query param as `<side>:<size>:<instrument>`; the instrument goes last
// because combo names contain colons.
const LiquidityLegParamSchema = z.string().transform((raw, ctx) => {
  const match = /^(buy|sell):([^:]+):(.+)$/.exec(raw);
  const parsed = LiquidityQuerySchema.safeParse(
    match ? { side: match[1], size: match[2], instrument: match[3] } : {},
  );
  if (!parsed.success) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `invalid leg "${raw}"` });
    return z.NEVER;
  }
  return parsed.data;
});

export const LiquidityCloseQuerySchema = z.object({
  leg: z.preprocess(
    (value) => (Array.isArray(value) ? value : value == null ? [] : [value]),
    z.array(LiquidityLegParamSchema).min(1).max(LIQUIDITY_CLOSE_MAX_LEGS),
  ),
});
export type LiquidityCloseQuery = z.infer<typeof LiquidityCloseQuerySchema>;

export function liquidityLegParam(query: LiquidityQuery): string {
  return `${query.side}:${query.size}:${query.instrument}`;
}

export const LiquidityQuoteSchema = LiquidityResponseSchema.omit({
  depth: true,
  bids: true,
  asks: true,
});
export type LiquidityQuote = z.infer<typeof LiquidityQuoteSchema>;

export const LiquidityCloseErrorSchema = z.enum([
  'unsupported',
  'rejected',
  'timeout',
  'capacity',
  'disposed',
]);
export type LiquidityCloseError = z.infer<typeof LiquidityCloseErrorSchema>;

export const LiquidityCloseItemSchema = z.object({
  instrument: z.string(),
  side: z.enum(['buy', 'sell']),
  size: z.number(),
  quote: LiquidityQuoteSchema.nullable(),
  error: LiquidityCloseErrorSchema.nullable(),
});
export type LiquidityCloseItem = z.infer<typeof LiquidityCloseItemSchema>;

export const LiquidityCloseResponseSchema = z.object({
  asOf: z.number(),
  items: z.array(LiquidityCloseItemSchema),
});
export type LiquidityCloseResponse = z.infer<typeof LiquidityCloseResponseSchema>;
