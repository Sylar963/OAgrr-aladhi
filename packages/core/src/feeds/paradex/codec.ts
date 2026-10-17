import {
  ParadexMarketsResponseSchema,
  ParadexRpcResponseSchema,
  ParadexSummarySchema,
  type ParadexMarket,
  type ParadexRpcResponse,
  type ParadexSummary,
} from './types.js';

export function parseParadexMarkets(input: unknown): ParadexMarket[] {
  const parsed = ParadexMarketsResponseSchema.safeParse(input);
  return parsed.success ? parsed.data.results : [];
}

/**
 * Validates only the summaries `accept` keeps. The bulk endpoint returns every market (~10k,
 * ~7MB), and callers need a fraction of them, so the symbol is checked before the element
 * goes through the schema. A malformed element is skipped rather than voiding the whole list.
 */
export function parseParadexSummariesWhere(
  input: unknown,
  accept: (symbol: string) => boolean,
): ParadexSummary[] {
  if (typeof input !== 'object' || input === null) return [];
  const results = (input as { results?: unknown }).results;
  if (!Array.isArray(results)) return [];
  const out: ParadexSummary[] = [];
  for (const element of results) {
    if (typeof element !== 'object' || element === null) continue;
    const symbol = (element as { symbol?: unknown }).symbol;
    if (typeof symbol !== 'string' || !accept(symbol)) continue;
    const parsed = ParadexSummarySchema.safeParse(element);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

export function parseParadexSummary(input: unknown): ParadexSummary | null {
  const parsed = ParadexSummarySchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export function parseParadexRpcResponse(input: unknown): ParadexRpcResponse | null {
  const parsed = ParadexRpcResponseSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}
