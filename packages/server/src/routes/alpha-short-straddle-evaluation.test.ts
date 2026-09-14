import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadSince: vi.fn(async () => []),
}));

vi.mock('../services.js', () => ({
  shortStraddleSnapshotStore: {
    loadSince: mocks.loadSince,
  },
}));

import { alphaShortStraddleEvaluationRoute } from './alpha-short-straddle-evaluation.js';

describe('alphaShortStraddleEvaluationRoute', () => {
  beforeEach(() => {
    mocks.loadSince.mockClear();
  });

  it('returns an explicit collection status when no follow-up marks exist', async () => {
    const app = Fastify();
    await app.register(alphaShortStraddleEvaluationRoute);

    const response = await app.inject({
      method: 'GET',
      url: '/alpha/short-straddle-evaluation?underlying=BTC',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      underlying: 'BTC',
      status: 'collecting',
      completedSampleCount: 0,
    });
    expect(mocks.loadSince).toHaveBeenCalledOnce();
    await app.close();
  });

  it('rejects unsupported underlyings at the API boundary', async () => {
    const app = Fastify();
    await app.register(alphaShortStraddleEvaluationRoute);

    const response = await app.inject({
      method: 'GET',
      url: '/alpha/short-straddle-evaluation?underlying=SOL',
    });

    expect(response.statusCode).toBe(400);
    expect(mocks.loadSince).not.toHaveBeenCalled();
    await app.close();
  });
});
