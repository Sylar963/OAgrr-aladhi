import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AlphaEvaluationResponseSchema, type AlphaEvaluationRequest } from '@oggregator/protocol';

const source = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('../alpha-evaluation-source.js', () => ({ loadAlphaEvaluationMarket: source.load }));
const { alphaEvaluationRoute } = await import('./alpha-evaluation.js');

function request(): AlphaEvaluationRequest {
  return {
    candidate: {
      strategy: 'long-put',
      underlying: 'BTC',
      expiryTs: Date.now() + 7 * 86_400_000,
      spot: 75_000,
      atmIv: 0.4,
      holdingQuantity: 0,
      entryFee: 1,
      costReserve: 2,
      lossBudget: 100,
      legs: [
        {
          venue: 'thalex',
          instrument: 'BTC-P',
          right: 'put',
          side: 'buy',
          strike: 74_000,
          quantity: 0.01,
          price: 1_000,
          fee: 100,
          availableQuantity: 1,
          minQuantity: 0.01,
          quantityStep: 0.01,
          quotedAt: Date.now(),
          quoteMode: 'live',
          markIv: 0.45,
          inverse: false,
          settlement: 'USD',
        },
      ],
    },
    scenario: { meanReturnPct: -5, annualVol: 0.5, meanUncertaintyPct: 2 },
    thesis: 'Bearish hypothesis',
    invalidation: 'A recovery above the prior high',
  };
}

afterEach(() => vi.clearAllMocks());

describe('Alpha evaluation endpoint', () => {
  it('validates the boundary before loading market data', async () => {
    const app = Fastify();
    await app.register(alphaEvaluationRoute);
    for (const body of [
      {},
      { ...request(), candidate: { ...request().candidate, strategy: 'call-credit' } },
    ]) {
      const response = await app.inject({ method: 'POST', url: '/alpha/evaluate', payload: body });
      expect(response.statusCode).toBe(400);
    }
    expect(source.load).not.toHaveBeenCalled();
    await app.close();
  });

  it('returns a versioned immutable snapshot with unknown history instead of inventing richness', async () => {
    source.load.mockResolvedValue({
      candles: [],
      ivHistory: null,
      baselineIv: { '7d': [], '30d': [] },
      regime: null,
    });
    const app = Fastify();
    await app.register(alphaEvaluationRoute);
    const input = request();
    const response = await app.inject({ method: 'POST', url: '/alpha/evaluate', payload: input });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const result = AlphaEvaluationResponseSchema.parse(response.json());
    expect(result.request).toEqual(input);
    expect(result.alignment).toBe('aligned');
    expect(result.pricing.forecastVol).toBeNull();
    expect(result.pricing.excessPremium).toBeNull();
    expect(result.execution.quoteSource).toBe('client-snapshot');
    expect(result.scenario).not.toBeNull();
    expect(result.evidence).toBe('unvalidated');
    await app.close();
  });

  it('preserves quote failures in the assessment and limits request size', async () => {
    source.load.mockResolvedValue({
      candles: [],
      ivHistory: null,
      baselineIv: { '7d': [], '30d': [] },
      regime: null,
    });
    const app = Fastify();
    await app.register(alphaEvaluationRoute);
    const input = request();
    input.candidate.legs[0]!.quotedAt = Date.now() - 60_000;
    const response = await app.inject({ method: 'POST', url: '/alpha/evaluate', payload: input });
    const result = AlphaEvaluationResponseSchema.parse(response.json());
    expect(result.execution.status).toBe('blocked');
    expect(result.execution.issues).toContain('stale-quote');
    const oversized = await app.inject({
      method: 'POST',
      url: '/alpha/evaluate',
      payload: { ...input, thesis: 'x'.repeat(20_000) },
    });
    expect(oversized.statusCode).toBe(413);
    await app.close();
  });
});
