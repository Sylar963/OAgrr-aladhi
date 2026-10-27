import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

const { get } = vi.hoisted(() => ({ get: vi.fn(async () => null) }));
vi.mock('../services.js', () => ({ flowEvidenceService: { get } }));
import { flowEvidenceRoute } from './flow-evidence.js';

describe('GET /flow/evidence', () => {
  it('validates trade identity and returns a clear missing-trade response', async () => {
    const app = Fastify();
    await app.register(flowEvidenceRoute);
    try {
      expect((await app.inject('/flow/evidence?mode=live&venue=unknown')).statusCode).toBe(400);
      expect(get).not.toHaveBeenCalled();
      const query = new URLSearchParams({
        mode: 'live',
        venue: 'deribit',
        underlying: 'BTC',
        instrument: 'BTC-30OCT26-80000-C',
        tradeUid: 'test',
        timestamp: '1000',
      });
      const response = await app.inject(`/flow/evidence?${query}`);
      expect(response.statusCode).toBe(404);
      expect(get).toHaveBeenCalledWith(
        expect.objectContaining({ timestamp: 1000, venue: 'deribit' }),
      );
    } finally {
      await app.close();
    }
  });
});
