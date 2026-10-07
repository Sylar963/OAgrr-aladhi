import { afterEach, describe, expect, it } from 'vitest';

import {
  beginPortfolioAssistantRuntimeRequest,
  disposeRuntimeMetrics,
  getRuntimeMetricsSnapshot,
  recordPortfolioAssistantFeedback,
  recordPortfolioAssistantFeedbackFlush,
  recordPortfolioAssistantRuntimeCompletion,
  recordPortfolioAssistantToolCall,
  setPortfolioAssistantFeedbackPending,
} from './runtime-metrics.js';

afterEach(() => disposeRuntimeMetrics());

describe('Portfolio Assistant runtime metrics', () => {
  it('tracks active runs, outcomes, tokens, duration, and provider failures', () => {
    const release = beginPortfolioAssistantRuntimeRequest();
    expect(getRuntimeMetricsSnapshot().portfolioAssistant.activeRequests).toBe(1);

    recordPortfolioAssistantRuntimeCompletion({
      outcome: 'failed',
      errorCode: 'provider_timeout',
      durationMs: 125,
      inputTokens: 40,
      outputTokens: 12,
    });
    release();
    release();

    expect(getRuntimeMetricsSnapshot().portfolioAssistant).toEqual({
      requestsTotal: { failed: 1 },
      activeRequests: 0,
      responseDurationMs: { count: 1, total: 125, average: 125, max: 125 },
      inputTokensTotal: 40,
      outputTokensTotal: 12,
      providerFailuresTotal: { provider_timeout: 1 },
      toolCalls: { byTool: {}, attributionTotal: {} },
      feedback: {
        votesTotal: {},
        downReasonsTotal: {},
        changedTotal: 0,
        pendingVotes: 0,
        flushedTotal: 0,
        flushSkippedTotal: 0,
      },
    });
  });

  it('counts feedback votes, changes and reasons without double counting re-submits', () => {
    recordPortfolioAssistantFeedback({ vote: 'up', reasons: [], previous: null });
    recordPortfolioAssistantFeedback({ vote: 'down', reasons: [], previous: null });
    recordPortfolioAssistantFeedback({
      vote: 'down',
      reasons: ['wrong_numbers', 'too_long'],
      previous: { vote: 'down', reasons: [] },
    });
    recordPortfolioAssistantFeedback({
      vote: 'down',
      reasons: ['wrong_numbers'],
      previous: { vote: 'up', reasons: [] },
    });
    setPortfolioAssistantFeedbackPending(3);
    recordPortfolioAssistantFeedbackFlush(2, 1);

    expect(getRuntimeMetricsSnapshot().portfolioAssistant.feedback).toEqual({
      votesTotal: { up: 1, down: 2 },
      downReasonsTotal: { wrong_numbers: 2, too_long: 1 },
      changedTotal: 1,
      pendingVotes: 3,
      flushedTotal: 2,
      flushSkippedTotal: 1,
    });
  });

  it('tracks per-tool calls, failures and latency, and attribution modes', () => {
    recordPortfolioAssistantToolCall({
      tool: 'oggregator_news',
      outcome: 'ok',
      attribution: 'exact',
      durationMs: 10,
    });
    recordPortfolioAssistantToolCall({
      tool: 'oggregator_news',
      outcome: 'timeout',
      attribution: 'none',
      durationMs: 30,
    });
    recordPortfolioAssistantToolCall({
      tool: 'oggregator_news',
      outcome: 'failed',
      attribution: 'none',
      durationMs: 20,
    });
    recordPortfolioAssistantToolCall({
      tool: 'oggregator_option_chain',
      outcome: 'rejected_input',
      attribution: 'ambiguous',
      durationMs: -5,
    });

    const snapshot = getRuntimeMetricsSnapshot().portfolioAssistant.toolCalls;
    expect(snapshot).toEqual({
      byTool: {
        oggregator_news: {
          calls: 3,
          failed: 1,
          timedOut: 1,
          rejected: 0,
          durationMs: { count: 3, total: 60, average: 20, max: 30 },
        },
        oggregator_option_chain: {
          calls: 1,
          failed: 0,
          timedOut: 0,
          rejected: 1,
          durationMs: { count: 1, total: 0, average: 0, max: 0 },
        },
      },
      attributionTotal: { exact: 1, none: 2, ambiguous: 1 },
    });
    const news = snapshot.byTool['oggregator_news'];
    if (news) news.calls = 99;
    expect(
      getRuntimeMetricsSnapshot().portfolioAssistant.toolCalls.byTool['oggregator_news']?.calls,
    ).toBe(3);
  });
});
