import {
  ParadexMarketsResponseSchema,
  ParadexSummarySchema,
  ParadexSummaryResponseSchema,
  type ParadexMarket,
  type ParadexSummary,
} from './types.js';

export function parseParadexMarkets(input: unknown): ParadexMarket[] {
  const parsed = ParadexMarketsResponseSchema.safeParse(input);
  return parsed.success ? parsed.data.results : [];
}

export function parseParadexSummaries(input: unknown): ParadexSummary[] {
  const parsed = ParadexSummaryResponseSchema.safeParse(input);
  return parsed.success ? parsed.data.results : [];
}

export function parseParadexSummary(input: unknown): ParadexSummary | null {
  const parsed = ParadexSummarySchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}
