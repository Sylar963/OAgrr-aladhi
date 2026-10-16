import type { PortfolioAssistantContext } from '../portfolio-assistant-context-builder.js';
import type { AssistantMarketDataReader } from './market-data-reader.js';
import {
  runStructureSearchTool,
  STRUCTURE_SEARCH_VERIFY_NOTE,
  type StructureSearchToolInput,
} from './structure-search-tool.js';
import type { StructureToolPortfolioAccess } from './structure-tool-support.js';

type StructureSearchView = StructureSearchToolInput['view'];
type MessageOrigin = 'question' | 'earlier_message';

export interface StructureSearchPrefetchRequest {
  view: StructureSearchView;
  viewFrom: MessageOrigin;
  maxTotalRiskUsd: number;
  budgetFrom: MessageOrigin;
  targetMovePct: number | null;
  size: number;
  minDte: number;
  maxDte: number;
}

/** A structure_search run with the context's portfolioRef, made before the model is called. */
export interface PortfolioAssistantStructureSearchFacts {
  request: StructureSearchPrefetchRequest;
  result: Record<string, unknown>;
}

export type StructureSearchPrefetchContext = Pick<
  PortfolioAssistantContext,
  'underlying' | 'positions' | 'portfolioRef' | 'riskBudgetFacts'
>;

export interface StructureSearchPrefetchOutcome {
  request: StructureSearchPrefetchRequest;
  facts: PortfolioAssistantStructureSearchFacts | null;
  outcome: 'ok' | 'error' | 'timeout';
  code: string | null;
  durationMs: number;
}

const DIRECTIONAL_VIEWS: ReadonlyArray<[StructureSearchView, RegExp]> = [
  ['bearish', /\bbearish\b/i],
  ['bullish', /\bbullish\b/i],
  ['long_vol', /\blong[\s-]?vol(?:atility)?\b|\bbuy(?:ing)?\s+vol(?:atility)?\b/i],
];
const HEDGE_PATTERN = /\b(?:hedge|cover)\b/i;
const BUDGET_KEYWORD =
  /\b(?:max(?:imum)?\s+(?:loss|risk)|total\s+risk|risk\s+budget|worst[\s-](?:case\s+)?loss)\b/i;
const AMOUNT_PATTERN = /\$\s?(\d[\d,]*(?:\.\d+)?)\s*(k)?\b|\b(\d[\d,]*(?:\.\d+)?)\s*(k)?\s*(?:usd|dollars)\b/gi;
const DOWN_MOVE = /\b(?:drops?|falls?|declines?|dumps?|crash(?:es)?|down)\s+(?:by\s+)?(\d+(?:\.\d+)?)\s?%/i;
const UP_MOVE = /\b(?:rises?|rall(?:y|ies)|pumps?|gains?|up)\s+(?:by\s+)?(\d+(?:\.\d+)?)\s?%/i;
// An amount belongs to the budget phrase when it sits this close to it.
const AMOUNT_AFTER_KEYWORD_CHARS = 80;
const AMOUNT_BEFORE_KEYWORD_CHARS = 30;
const EARLIER_MESSAGES_SCANNED = 3;
const DEFAULT_MIN_DTE = 1;
const DEFAULT_MAX_DTE = 45;
export const STRUCTURE_SEARCH_PREFETCH_TIMEOUT_MS = 15_000;

function parseView(text: string, hasUncoveredShorts: boolean): StructureSearchView | null {
  const matched = DIRECTIONAL_VIEWS.filter(([, pattern]) => pattern.test(text)).map(([view]) => view);
  if (matched.length > 1) return null;
  if (matched[0] != null) return matched[0];
  return hasUncoveredShorts && HEDGE_PATTERN.test(text) ? 'hedge_held_shorts' : null;
}

function parseBudgetUsd(text: string): number | null {
  const keyword = BUDGET_KEYWORD.exec(text);
  if (keyword == null) return null;
  const keywordEnd = keyword.index + keyword[0].length;
  let after: number | null = null;
  let before: number | null = null;
  for (const match of text.matchAll(AMOUNT_PATTERN)) {
    const digits = match[1] ?? match[3];
    if (digits == null) continue;
    const value = Number(digits.replace(/,/g, '')) * ((match[2] ?? match[4]) == null ? 1 : 1_000);
    if (!Number.isFinite(value) || value <= 0) continue;
    if (match.index >= keywordEnd && match.index - keywordEnd <= AMOUNT_AFTER_KEYWORD_CHARS) {
      after ??= value;
    } else if (match.index < keyword.index && keyword.index - (match.index + match[0].length) <= AMOUNT_BEFORE_KEYWORD_CHARS) {
      before = value;
    }
  }
  return after ?? before;
}

function parseTargetMovePct(text: string, view: StructureSearchView): number | null {
  if (view === 'bearish') {
    const down = DOWN_MOVE.exec(text);
    return down?.[1] == null ? null : -Number(down[1]);
  }
  if (view === 'bullish') {
    const up = UP_MOVE.exec(text);
    return up?.[1] == null ? null : Number(up[1]);
  }
  return null;
}

function bookUnderlying(context: StructureSearchPrefetchContext): string | null {
  if (context.underlying != null) return context.underlying.toUpperCase();
  const underlyings = new Set(context.positions.filter((leg) => leg.size !== 0).map((leg) => leg.underlying));
  return underlyings.size === 1 ? ([...underlyings][0] ?? null) : null;
}

/** Contracts per new leg: the smallest held size, so a 0.1-lot book is not searched at 1 lot. */
function searchSize(context: StructureSearchPrefetchContext, underlying: string): number {
  const sizes = context.positions
    .filter((leg) => leg.underlying.toUpperCase() === underlying && leg.size !== 0)
    .map((leg) => Math.abs(leg.size));
  return sizes.length === 0 ? 1 : Math.min(1, ...sizes);
}

/**
 * Reads a constraint question ("bearish trade, total max loss within $2,200") into structure_search
 * arguments. The current message must give the view or the budget; the other may come from one of
 * the user's last few messages. Anything ambiguous returns null and the model searches itself.
 */
export function planStructureSearchPrefetch(
  question: string,
  earlierUserMessages: readonly string[],
  context: StructureSearchPrefetchContext,
): { underlying: string; request: StructureSearchPrefetchRequest } | null {
  const underlying = bookUnderlying(context);
  if (underlying == null) return null;
  const hasUncoveredShorts = context.riskBudgetFacts.uncoveredShorts.length > 0;
  const earlier = earlierUserMessages.slice(0, EARLIER_MESSAGES_SCANNED);

  const currentView = parseView(question, hasUncoveredShorts);
  const currentBudget = parseBudgetUsd(question);
  if (currentView == null && currentBudget == null) return null;
  const earlierView = currentView == null ? earlier.map((text) => parseView(text, hasUncoveredShorts)).find((view) => view != null) : null;
  const earlierBudget = currentBudget == null ? earlier.map(parseBudgetUsd).find((budget) => budget != null) : null;
  const view = currentView ?? earlierView ?? null;
  const budget = currentBudget ?? earlierBudget ?? null;
  if (view == null || budget == null) return null;

  return {
    underlying,
    request: {
      view,
      viewFrom: currentView == null ? 'earlier_message' : 'question',
      maxTotalRiskUsd: budget,
      budgetFrom: currentBudget == null ? 'earlier_message' : 'question',
      targetMovePct: parseTargetMovePct(question, view),
      size: searchSize(context, underlying),
      minDte: DEFAULT_MIN_DTE,
      maxDte: DEFAULT_MAX_DTE,
    },
  };
}

export class StructureSearchPrefetch {
  constructor(
    private readonly reader: AssistantMarketDataReader,
    private readonly portfolio: StructureToolPortfolioAccess,
    private readonly now: () => number = Date.now,
    private readonly timeoutMs = STRUCTURE_SEARCH_PREFETCH_TIMEOUT_MS,
  ) {}

  async prefetchForQuestion(
    question: string,
    earlierUserMessages: readonly string[],
    context: StructureSearchPrefetchContext,
  ): Promise<StructureSearchPrefetchOutcome | null> {
    const plan = planStructureSearchPrefetch(question, earlierUserMessages, context);
    if (plan == null) return null;
    const { request } = plan;
    const startedAt = Date.now();
    const finish = (
      outcome: StructureSearchPrefetchOutcome['outcome'],
      code: string | null,
      facts: PortfolioAssistantStructureSearchFacts | null,
    ): StructureSearchPrefetchOutcome => ({ request, facts, outcome, code, durationMs: Date.now() - startedAt });

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), this.timeoutMs);
    });
    try {
      const result = await Promise.race([
        runStructureSearchTool(
          this.reader,
          this.portfolio,
          {
            portfolioRef: context.portfolioRef,
            underlying: plan.underlying,
            view: request.view,
            maxTotalRiskUsd: request.maxTotalRiskUsd,
            minDte: request.minDte,
            maxDte: request.maxDte,
            ...(request.targetMovePct == null ? {} : { targetMovePct: request.targetMovePct }),
            maxSpreadPct: 25,
            limit: 5,
            size: request.size,
          },
          this.now(),
        ),
        timeout,
      ]);
      if (result === 'timeout') return finish('timeout', 'timeout', null);
      if (!result.ok) return finish('error', result.code ?? 'error', null);
      const notes = Array.isArray(result.data['notes'])
        ? result.data['notes'].filter((note) => note !== STRUCTURE_SEARCH_VERIFY_NOTE)
        : result.data['notes'];
      return finish('ok', null, { request, result: { ...result.data, notes } });
    } catch {
      return finish('error', 'internal_error', null);
    } finally {
      clearTimeout(timer);
    }
  }
}
