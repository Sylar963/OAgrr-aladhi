import { afterEach, describe, expect, it } from 'vitest';

import {
  beginPortfolioAssistantRuntimeRequest,
  disposeRuntimeMetrics,
  getRuntimeMetricsSnapshot,
  recordPortfolioAssistantRuntimeCompletion,
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
    });
  });
});
