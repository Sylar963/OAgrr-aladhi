import { describe, expect, it } from 'vitest';
import {
  getFeedHealthSnapshot,
  getLivenessMaxMs,
  isFeedLivenessStale,
  type FeedHealthSources,
} from './feed-health.js';

function buildSources(opts: {
  spot: { connected: boolean; lastSuccessAt: number | null; errors?: number };
  flow?: Array<{
    venue: string;
    underlying: string;
    connected: boolean;
    lastMessageAt: number | null;
    reconnects?: number;
    errors?: number;
  }>;
  blockFlow?: Array<{
    venue: string;
    connected: boolean;
    lastSuccessAt: number | null;
    reconnects?: number;
    errors?: number;
  }>;
}): FeedHealthSources {
  return {
    spot: {
      getHealth: () => ({
        connected: opts.spot.connected,
        symbols: [],
        lastSuccessAt: opts.spot.lastSuccessAt,
        lastStatusAt: opts.spot.lastSuccessAt,
        errors: opts.spot.errors ?? 0,
      }),
    },
    flow: {
      getHealth: () =>
        (opts.flow ?? []).map((row) => ({
          venue: row.venue as never,
          underlying: row.underlying,
          connected: row.connected,
          lastMessageAt: row.lastMessageAt,
          lastTradeAt: row.lastMessageAt,
          lastStatusAt: row.lastMessageAt,
          reconnects: row.reconnects ?? 0,
          errors: row.errors ?? 0,
          seedTrades: 0,
          bufferedTrades: 0,
        })),
    },
    blockFlow: {
      getHealth: () =>
        (opts.blockFlow ?? []).map((row) => ({
          venue: row.venue as never,
          transport: 'ws' as const,
          connected: row.connected,
          lastSuccessAt: row.lastSuccessAt,
          lastTradeAt: row.lastSuccessAt,
          lastStatusAt: row.lastSuccessAt,
          lastPollCount: 0,
          pollLimit: null,
          hitLimitCount: 0,
          reconnects: row.reconnects ?? 0,
          errors: row.errors ?? 0,
          bufferedTrades: 0,
        })),
    },
  };
}

describe('getFeedHealthSnapshot', () => {
  it('folds spot, flow, and block-flow into a per-venue rollup', () => {
    const now = 1_000_000;
    const sources = buildSources({
      spot: { connected: true, lastSuccessAt: now - 5_000 },
      flow: [
        { venue: 'deribit', underlying: 'BTC', connected: true, lastMessageAt: now - 1_000 },
        { venue: 'deribit', underlying: 'ETH', connected: true, lastMessageAt: now - 30_000 },
        { venue: 'okx', underlying: 'BTC', connected: false, lastMessageAt: now - 120_000, errors: 4 },
      ],
      blockFlow: [
        { venue: 'deribit', connected: true, lastSuccessAt: now - 8_000 },
      ],
    });

    const snap = getFeedHealthSnapshot(sources, now);

    expect(snap.summary).toEqual({
      totalVenues: 3,
      connectedVenues: 2,
      lastAnyMessageAgeMs: 1_000,
    });

    const deribit = snap.venues.find((v) => v.venue === 'deribit');
    expect(deribit).toMatchObject({
      sources: ['blockFlow', 'flow'],
      connected: true,
      lastMessageAgeMs: 1_000,
    });

    const okx = snap.venues.find((v) => v.venue === 'okx');
    expect(okx).toMatchObject({
      sources: ['flow'],
      connected: false,
      lastMessageAgeMs: 120_000,
      errors: 4,
    });

    const bybit = snap.venues.find((v) => v.venue === 'bybit');
    expect(bybit).toMatchObject({
      sources: ['spot'],
      connected: true,
      lastMessageAgeMs: 5_000,
    });
  });

  it('reports null lastMessageAge when no source has produced data yet', () => {
    const snap = getFeedHealthSnapshot(
      buildSources({ spot: { connected: false, lastSuccessAt: null } }),
      1_000,
    );
    expect(snap.summary.lastAnyMessageAgeMs).toBeNull();
    expect(snap.venues[0]?.lastMessageAgeMs).toBeNull();
  });
});

describe('isFeedLivenessStale', () => {
  const baseSources = buildSources({
    spot: { connected: true, lastSuccessAt: 100_000 },
  });

  it('returns false before any feed produces data (still bootstrapping)', () => {
    const empty = getFeedHealthSnapshot(
      buildSources({ spot: { connected: false, lastSuccessAt: null } }),
      0,
    );
    expect(isFeedLivenessStale(empty, 90_000)).toBe(false);
  });

  it('returns false while the newest message is within the window', () => {
    const fresh = getFeedHealthSnapshot(baseSources, 100_000 + 30_000);
    expect(isFeedLivenessStale(fresh, 90_000)).toBe(false);
  });

  it('returns true once the newest message exceeds the threshold', () => {
    const stale = getFeedHealthSnapshot(baseSources, 100_000 + 100_000);
    expect(isFeedLivenessStale(stale, 90_000)).toBe(true);
  });
});

describe('getLivenessMaxMs', () => {
  it('defaults to 5 minutes when env is unset', () => {
    expect(getLivenessMaxMs({})).toBe(300_000);
  });

  it('reads FEED_LIVENESS_MAX_MS when valid', () => {
    expect(getLivenessMaxMs({ FEED_LIVENESS_MAX_MS: '120000' })).toBe(120_000);
  });

  it('falls back to the default on garbage input', () => {
    expect(getLivenessMaxMs({ FEED_LIVENESS_MAX_MS: 'abc' })).toBe(300_000);
    expect(getLivenessMaxMs({ FEED_LIVENESS_MAX_MS: '0' })).toBe(300_000);
    expect(getLivenessMaxMs({ FEED_LIVENESS_MAX_MS: '-5' })).toBe(300_000);
  });
});
