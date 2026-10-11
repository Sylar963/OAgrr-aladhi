import { z } from 'zod';

export const BREAK_EVEN_RESOLUTION_SEC = 3600;
export const BREAK_EVEN_UNDERLYINGS = ['BTC', 'ETH'] as const;

export const BreakEvenQuerySchema = z.object({
  underlying: z
    .string()
    .trim()
    .transform((value) => value.toUpperCase())
    .pipe(z.enum(BREAK_EVEN_UNDERLYINGS)),
  expiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export type BreakEvenQuery = z.infer<typeof BreakEvenQuerySchema>;

export const BreakEvenPointSchema = z.object({
  /** Epoch ms. */
  ts: z.number().int(),
  value: z.number(),
});

export type BreakEvenPoint = z.infer<typeof BreakEvenPointSchema>;

export const BreakEvenLineSchema = z.object({
  strike: z.number(),
  right: z.enum(['call', 'put']),
  markIv: z.number(),
  /** Black-76 delta from the mark IV, not the venue's premium-adjusted delta. */
  delta: z.number(),
  premiumUsd: z.number(),
  breakEven: z.number(),
  /** Risk-neutral probability of finishing beyond the strike: N(d2) for calls, N(−d2) for puts. */
  impliedProb: z.number(),
  /**
   * Share of past same-length BTC/ETH moves (trend removed) that would have finished beyond
   * the strike. A historical frequency, not a forecast.
   */
  historicalProb: z.number().nullable(),
  history: z.array(BreakEvenPointSchema),
  projection: z.array(BreakEvenPointSchema),
});

export type BreakEvenLine = z.infer<typeof BreakEvenLineSchema>;

export const BreakEvenResponseSchema = z.object({
  underlying: z.string(),
  expiry: z.string(),
  expiryTs: z.number().int(),
  asOf: z.number().int(),
  spot: z.number(),
  forward: z.number(),
  resolutionSec: z.literal(BREAK_EVEN_RESOLUTION_SEC),
  /** First recorded smile for this expiry, epoch ms; null until the sampler has one. */
  recordedSince: z.number().int().nullable(),
  historical: z.object({
    horizonDays: z.number().int(),
    /** Overlapping windows behind `historicalProb`; independent samples ≈ windows / horizonDays. */
    windows: z.number().int(),
    lookbackDays: z.number().int(),
  }),
  spotHistory: z.array(BreakEvenPointSchema),
  lines: z.array(BreakEvenLineSchema),
});

export type BreakEvenResponse = z.infer<typeof BreakEvenResponseSchema>;
