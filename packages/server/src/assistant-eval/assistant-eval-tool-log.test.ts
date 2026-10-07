import { describe, expect, it } from 'vitest';

import { hashPortfolioRef } from '../assistant-market/assistant-run-registry.js';
import { matchEvalToolCalls } from './assistant-eval-tool-log.js';

const FIXTURE_REF = 'pref_evalFixtureNotResolvable';
const PRODUCT_REF = 'pref_QUFBQUFBQUFBQUFBQUFBQQ';
const MSG = 'assistant mcp tool call';

function line(fields: Record<string, unknown>): string {
  return JSON.stringify({ level: 30, msg: MSG, time: 1_500, ...fields });
}

describe('matchEvalToolCalls', () => {
  it('prefers the fixture ref hash, drops other runs, and falls back to the window', () => {
    const journal = [
      line({
        tool: 'oggregator_evaluate_structure',
        outcome: 'ok',
        attribution: 'none',
        portfolioRefHash: hashPortfolioRef(FIXTURE_REF),
      }),
      line({
        tool: 'oggregator_evaluate_structure',
        outcome: 'ok',
        attribution: 'exact',
        requestId: 'r1',
        portfolioRefHash: hashPortfolioRef(PRODUCT_REF),
      }),
      line({
        tool: 'oggregator_option_chain',
        outcome: 'ok',
        attribution: 'single_active',
        requestId: 'r1',
      }),
      line({ tool: 'oggregator_news' }),
      line({ tool: 'oggregator_feed_health', outcome: 'failed', attribution: 'none' }),
      line({ tool: 'oggregator_trade_flow', outcome: 'ok', time: 9_000 }),
      line({ tool: null, outcome: 'rejected_input' }),
      JSON.stringify({ msg: 'assistant mcp tool rejected', time: 1_500, tool: 'oggregator_news' }),
      `not json ${MSG}`,
    ].join('\n');

    expect(
      matchEvalToolCalls(journal, { startedAt: 1_000, until: 2_000, portfolioRef: FIXTURE_REF }),
    ).toEqual({
      tools: ['oggregator_evaluate_structure', 'oggregator_option_chain', 'oggregator_news'],
      matchedByRef: 1,
      matchedByWindow: 2,
      excludedOtherRuns: 1,
    });
  });
});
