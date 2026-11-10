import Fastify from 'fastify';
import { ExpectedMoveResponseSchema, ExpectedStraddleResponseSchema } from '@oggregator/protocol';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sources = vi.hoisted(() => ({ candles: vi.fn(), history: vi.fn(), snapshot: vi.fn() }));
vi.mock('../services.js', () => ({
  aggregatedSpotRuntime: { getCandles: sources.candles },
  isDvolReady: () => true,
  dvolService: { getHistory: sources.history, getSnapshot: sources.snapshot },
}));
const { expectedMoveRoute } = await import('./expected-move.js');

beforeEach(() => {
  sources.candles.mockReset().mockResolvedValue({ candles: [], sources: [] });
  sources.history.mockReset().mockReturnValue([]);
  sources.snapshot.mockReset().mockReturnValue(null);
});

describe('expected-move routes', () => {
  it('validates assets, anchors, bounded history and venue combinations before I/O', async () => {
    const app = Fastify();
    await app.register(expectedMoveRoute);
    for (const path of [
      '/expected-move?underlying=SOL&anchor=utc0',
      '/expected-move?underlying=SPX&anchor=cash',
      '/expected-move?underlying=BTC&anchor=cash',
      '/expected-move?underlying=BTC&anchor=utc0&days=10000',
      '/expected-move/straddle?underlying=BTC&venue=tastytrade&expiry=2026-11-09',
      '/expected-move/straddle?underlying=BTC&venue=deribit&expiry=2026-02-30',
    ])
      expect((await app.inject(path)).statusCode).toBe(400);
    expect(sources.candles).not.toHaveBeenCalled();
    await app.close();
  });

  it('returns honest missing-history state and filters stale index values', async () => {
    sources.snapshot.mockReturnValue({ current: 0.5, updatedAt: Date.now() - 180_000 });
    const app = Fastify();
    await app.register(expectedMoveRoute);
    const res = await app.inject('/expected-move?underlying=BTC&anchor=utc8');
    expect(res.statusCode).toBe(200);
    const report = ExpectedMoveResponseSchema.parse(res.json());
    expect(report.current).toBeNull();
    expect(report.liveIv).toBeNull();
    expect(report.periodsPerYear).toBe(365);
    const straddle = await app.inject(
      '/expected-move/straddle?underlying=BTC&venue=deribit&expiry=2026-11-09',
    );
    expect(ExpectedStraddleResponseSchema.parse(straddle.json()).status).toBe('unavailable');
    await app.close();
  });

  it('surfaces upstream failures without fabricating a daily result', async () => {
    sources.candles.mockRejectedValue(new Error('offline'));
    const app = Fastify();
    await app.register(expectedMoveRoute);
    expect((await app.inject('/expected-move?underlying=ETH&anchor=utc0')).statusCode).toBe(502);
    await app.close();
  });
});
