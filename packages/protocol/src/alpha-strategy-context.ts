import { z } from 'zod';

export const AlphaContextStrategySchema = z.enum([
  'call-credit',
  'put-credit',
  'call-debit',
  'put-debit',
  'long-call',
  'long-put',
  'protective-put',
]);
export const AlphaContextReasonSchema = z.enum([
  'price-up',
  'price-down',
  'direction-conflict',
  'direction-unconfirmed',
  'reversal-risk',
  'vol-below-range',
  'vol-above-range',
  'vol-within-range',
  'pricing-unknown',
  'vol-accelerating',
  'front-vol-stress',
  'credit-premium-thin',
  'upside-short-risk',
  'downside-short-risk',
  'vertical-price-check',
  'insurance-purpose',
  'insurance-expensive',
  'history-unavailable',
  'horizon-unsupported',
  'near-expiry',
  'wing-pricing',
  'wing-pricing-unavailable',
]);
const number = z.number().finite().nullable();
const assessment = z.object({
  verdict: z.enum(['supported', 'conditional', 'poor-fit', 'unavailable']),
  reasons: z.array(AlphaContextReasonSchema).min(1),
});

export const AlphaStrategyContextSchema = z.object({
  version: z.literal('market-context-v2'),
  horizonDays: z.number().finite(),
  horizonSource: z.enum(['selected-expiry', 'scan-reference']),
  direction: z.enum(['up', 'down', 'range', 'transition', 'unavailable']),
  directionBasis: z.enum(['hourly', 'daily', 'unavailable']),
  moves: z.array(z.object({ hours: z.number(), returnPct: z.number(), sigmaUnits: z.number() })),
  pricing: z.object({
    atmIv: number,
    call25Iv: number,
    put25Iv: number,
    source: z.enum(['selected-chain', '7d', '30d', 'interpolated', 'unavailable']),
    forecastVol: number,
    deliveryLow: number,
    deliveryHigh: number,
    deliveryWindowDays: z.number(),
    calibrationWindows: z.number().int().nonnegative(),
  }),
  stress: z.object({
    rv7d: number,
    rv30d: number,
    accelerationRatio: number,
    accelerationPercentile: number,
    accelerating: z.boolean(),
    backwardation: z.boolean().nullable(),
  }),
  assessments: z.object({
    'call-credit': assessment,
    'put-credit': assessment,
    'call-debit': assessment,
    'put-debit': assessment,
    'long-call': assessment,
    'long-put': assessment,
    'protective-put': assessment,
  }),
});

export type AlphaContextStrategy = z.infer<typeof AlphaContextStrategySchema>;
export type AlphaContextReason = z.infer<typeof AlphaContextReasonSchema>;
export type AlphaStrategyContext = z.infer<typeof AlphaStrategyContextSchema>;
