import { describe, expect, it } from 'vitest';

import { ShortStraddleEvaluationQuerySchema } from './short-straddle-evaluation.js';

describe('ShortStraddleEvaluationQuerySchema', () => {
  it('applies conservative report defaults', () => {
    expect(ShortStraddleEvaluationQuerySchema.parse({})).toEqual({
      underlying: 'BTC',
      windowDays: 90,
      minimumSamples: 100,
    });
  });

  it('rejects unsupported underlyings and undersized evidence thresholds', () => {
    expect(
      ShortStraddleEvaluationQuerySchema.safeParse({ underlying: 'SOL' }).success,
    ).toBe(false);
    expect(
      ShortStraddleEvaluationQuerySchema.safeParse({ minimumSamples: 9 }).success,
    ).toBe(false);
  });

  it('normalizes lowercase supported underlyings', () => {
    expect(ShortStraddleEvaluationQuerySchema.parse({ underlying: 'eth' }).underlying).toBe('ETH');
  });
});
