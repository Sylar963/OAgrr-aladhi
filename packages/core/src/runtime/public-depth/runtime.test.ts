import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { BotDepthQuerySchema, type VenueExecutionQuote } from '@oggregator/protocol';
import { PublicDepthRuntime, normalizePublicDepth } from './runtime.js';
import type { NativeDepthSnapshot, PublicDepthFetcher } from '../../feeds/shared/public-depth.js';
import { fetchPublicDepth as deribit } from '../../feeds/deribit/public-depth.js';
import { fetchPublicDepth as okx } from '../../feeds/okx/public-depth.js';
import { fetchPublicDepth as bybit } from '../../feeds/bybit/public-depth.js';
import { fetchPublicDepth as binance } from '../../feeds/binance/public-depth.js';
import { fetchPublicDepth as coincall } from '../../feeds/coincall/public-depth.js';
import { fetchPublicDepth as gateio } from '../../feeds/gateio/public-depth.js';
import { fetchPublicDepth as paradex } from '../../feeds/paradex/public-depth.js';
import { fetchPublicDepth as thalex } from '../../feeds/thalex/public-depth.js';

const fixtures = JSON.parse(
  readFileSync(new URL('./__fixtures__/public-books.json', import.meta.url), 'utf8'),
) as Record<string, { symbol: string; execution: VenueExecutionQuote; payload: unknown }>;
const now = 1795238000000;
const execution = fixtures['okx']!.execution;
const query = BotDepthQuerySchema.parse({
  venue: 'okx',
  underlying: 'BTC',
  expiry: '2026-11-27',
  instrument: execution.exchangeSymbol,
});
const context = { execution, underlyingPriceUsd: 60000, asOfMs: now };
function book(): NativeDepthSnapshot {
  return {
    bids: [[0.04, 2]],
    asks: [[0.042, 3]],
    exchangeTs: now,
    lastChangeAt: now,
    sequence: '1',
    sourceMaxLevels: 20,
    exchangeTimestampBasis: 'generation',
    receivedAt: now,
    requestedAt: now,
  };
}
const derive = { snapshot: vi.fn(), dispose: vi.fn(async () => {}) };

describe('public depth schemas from live 2026-11-21 captures', () => {
  for (const [venue, provider] of Object.entries({
    deribit,
    okx,
    bybit,
    binance,
    coincall,
    gateio,
    paradex,
    thalex,
  })) {
    it(`parses ${venue} native depth and preserves symbol/access`, async () => {
      const fixture = fixtures[venue]!;
      const data = await (provider as PublicDepthFetcher)(
        fixture.symbol,
        async () => fixture.payload,
        'api',
      );
      expect(data.sourceMaxLevels).toBeGreaterThan(0);
      for (const [price, size] of [...data.bids, ...data.asks]) {
        expect(Number.isFinite(price)).toBe(true);
        expect(Number.isFinite(size)).toBe(true);
      }
      if (venue === 'paradex') expect(data.bids).toEqual([]);
      if (venue === 'coincall') expect(data.exchangeTs).toBeNull();
    });
  }
});

describe('canonical depth units and validity', () => {
  it('converts native contracts to base and inverse premium to USD without multiplying price twice', () => {
    const data = normalizePublicDepth(book(), query, context, now);
    expect(data.dataReady).toBe(true);
    expect(data.bids[0]).toEqual({
      nativePrice: 0.04,
      nativeQuantity: 2,
      priceUsdPerBase: 2400,
      quantityBase: 0.02,
    });
    expect(data.contract.nativeQuantityStep).toBe(1);
  });
  it('retains raw inverse prices when conversion reference is absent or stale', () => {
    const data = normalizePublicDepth(
      book(),
      query,
      { ...context, underlyingPriceUsd: null, asOfMs: null },
      now,
    );
    expect(data.bids[0]?.nativePrice).toBe(0.04);
    expect(data.bids[0]?.priceUsdPerBase).toBeNull();
    expect(data.reasons).toContain('missing-or-stale-conversion-reference');
    expect(
      normalizePublicDepth(book(), query, { ...context, asOfMs: now - 6000 }, now).dataReady,
    ).toBe(false);
  });
  it('exposes empty, one-sided, crossed, stale and future books without invented levels', () => {
    expect(
      normalizePublicDepth({ ...book(), bids: [], asks: [] }, query, context, now).bookState,
    ).toBe('empty');
    expect(normalizePublicDepth({ ...book(), asks: [] }, query, context, now).dataReady).toBe(
      false,
    );
    expect(
      normalizePublicDepth({ ...book(), bids: [[0.05, 2]] }, query, context, now).reasons,
    ).toContain('crossed-book');
    expect(
      normalizePublicDepth({ ...book(), receivedAt: now - 6000 }, query, context, now).reasons,
    ).toContain('stale-receive-time');
    expect(
      normalizePublicDepth({ ...book(), exchangeTs: now + 6000 }, query, context, now).reasons,
    ).toContain('future-timestamp');
  });
  it('rejects negative/duplicate levels and mismatched contract metadata', () => {
    expect(() =>
      normalizePublicDepth({ ...book(), bids: [[-1, 2]] }, query, context, now),
    ).toThrow();
    expect(() =>
      normalizePublicDepth(
        {
          ...book(),
          bids: [
            [1, 2],
            [1, 3],
          ],
        },
        query,
        context,
        now,
      ),
    ).toThrow();
    expect(() =>
      normalizePublicDepth(book(), { ...query, instrument: 'OTHER' }, context, now),
    ).toThrow();
  });
});

describe('bounded shared depth fetching', () => {
  it('coalesces requests and preserves original receive time on cache hits', async () => {
    let time = now;
    const provider = vi.fn<PublicDepthFetcher>(async () => book());
    const runtime = new PublicDepthRuntime({
      provider: { okx: provider },
      derive,
      now: () => time,
    });
    await Promise.all([runtime.snapshot(query, context), runtime.snapshot(query, context)]);
    expect(provider).toHaveBeenCalledOnce();
    time += 500;
    expect((await runtime.snapshot(query, context)).bookAgeMs).toBe(500);
    expect(provider).toHaveBeenCalledOnce();
    await runtime.dispose();
  });
  it('enforces the Thalex 30s snapshot cache and never switches Paradex access mode', async () => {
    let time = now;
    const provider = vi.fn<PublicDepthFetcher>(async () => book());
    const runtime = new PublicDepthRuntime({
      provider: { thalex: provider, paradex: provider },
      derive,
      now: () => time,
    });
    await runtime.snapshot({ ...query, venue: 'thalex' }, context);
    time += 6000;
    expect((await runtime.snapshot({ ...query, venue: 'thalex' }, context)).dataReady).toBe(false);
    expect(provider).toHaveBeenCalledOnce();
    await runtime.snapshot({ ...query, venue: 'paradex', access: 'api' }, context);
    await runtime.snapshot({ ...query, venue: 'paradex', access: 'interactive' }, context);
    expect(provider.mock.calls.map((call) => call[2])).toEqual(['api', 'api', 'interactive']);
    await runtime.dispose();
  });
  it('returns explicit source errors and blocks requests after shutdown', async () => {
    const runtime = new PublicDepthRuntime({
      fetchImpl: vi.fn(async () => new Response('{}', { status: 503 })),
      derive,
      now: () => now,
    });
    await expect(runtime.snapshot(query, context)).rejects.toMatchObject({
      reason: 'upstream-http',
    });
    await expect(
      runtime.snapshot({ ...query, access: 'interactive' }, context),
    ).rejects.toMatchObject({ reason: 'unsupported-access' });
    await runtime.dispose();
    await expect(runtime.snapshot(query, context)).rejects.toMatchObject({ reason: 'disposed' });
  });
});
