import { describe, expect, it, vi } from 'vitest';

import {
  type Broadcaster,
  BroadcastRegistry,
  summarizeEquity,
  type VenueAccountAccess,
  VenueEquityCache,
} from './social-broadcast.js';

const NOW = Date.parse('2026-10-12T12:00:00.000Z');
const DAY_MS = 86_400_000;
const LOG = { warn: vi.fn() };

const ALPHA: Broadcaster = {
  userId: 'usr_a',
  handle: 'Alpha',
  accountId: 'acct_a',
  venue: 'derive',
  sharingSince: new Date('2026-10-01T00:00:00.000Z'),
};
const BETA: Broadcaster = {
  userId: 'usr_b',
  handle: 'beta',
  accountId: 'acct_b',
  venue: 'paradex',
  sharingSince: new Date('2026-10-01T00:00:00.000Z'),
};

function fakeAccess(connected: Set<string>): VenueAccountAccess & {
  keepAlive: ReturnType<typeof vi.fn>;
  restore: ReturnType<typeof vi.fn>;
} {
  return {
    isConnected: (accountId, venue) => connected.has(`${accountId}|${venue}`),
    restore: vi.fn(async (accountId: string, venue: string) => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      connected.add(`${accountId}|${venue}`);
      return 'connected' as const;
    }),
    keepAlive: vi.fn(),
    listLegs: () => [],
    fetchEquityHistory: vi.fn(async () => []),
    loadTrades: async () => null,
    subscribe: () => () => {},
  };
}

describe('BroadcastRegistry', () => {
  it('pins members open, restores missing connections and reloads only when invalidated', async () => {
    let rows = [ALPHA, BETA];
    const store = { listBroadcasters: vi.fn(async () => rows) };
    const access = fakeAccess(new Set(['acct_a|derive']));
    const onConnected = vi.fn();
    const registry = new BroadcastRegistry(store, access, LOG, onConnected, () => NOW);

    expect((await registry.live()).map((row) => row.handle)).toEqual(['Alpha']);
    expect(access.keepAlive).toHaveBeenCalledWith('acct_a', 'derive', true);
    expect(access.keepAlive).toHaveBeenCalledWith('acct_b', 'paradex', true);
    await registry.settled();
    expect(access.restore).toHaveBeenCalledWith('acct_b', 'paradex');
    expect(onConnected).toHaveBeenCalledTimes(1);
    expect((await registry.live()).map((row) => row.handle)).toEqual(['Alpha', 'beta']);
    expect(store.listBroadcasters).toHaveBeenCalledTimes(1);

    rows = [ALPHA];
    registry.invalidate();
    await registry.all();
    expect(access.keepAlive).toHaveBeenCalledWith('acct_b', 'paradex', false);
    await expect(registry.find('alpha')).resolves.toMatchObject({
      broadcaster: ALPHA,
      connected: true,
    });
    await expect(registry.find('beta')).resolves.toBeNull();
    registry.dispose();
  });

  it('does not retry a failed reconnect on every load', async () => {
    const store = { listBroadcasters: vi.fn(async () => [BETA]) };
    const access = fakeAccess(new Set());
    access.restore.mockResolvedValue('not_connected');
    const registry = new BroadcastRegistry(store, access, LOG, vi.fn(), () => NOW);
    await registry.all();
    await registry.settled();
    registry.invalidate();
    await registry.all();
    await registry.settled();
    expect(access.restore).toHaveBeenCalledTimes(1);
    registry.dispose();
  });
});

describe('VenueEquityCache', () => {
  it('shares one venue call per account until the cache expires', async () => {
    let nowMs = NOW;
    const access = {
      fetchEquityHistory: vi.fn(async () => [
        { ts: NOW - DAY_MS, equityUsd: 1 },
        { ts: NOW - DAY_MS + 60_000, equityUsd: 2 },
      ]),
    };
    const cache = new VenueEquityCache(access, () => nowMs, 60_000);
    const [a, b] = await Promise.all([
      cache.get('acct_a', 'derive'),
      cache.get('acct_a', 'derive'),
    ]);
    expect(a).toBe(b);
    expect(a?.points).toEqual([{ ts: NOW - DAY_MS + 60_000, equityUsd: 2 }]);
    nowMs += 61_000;
    await cache.get('acct_a', 'derive');
    expect(access.fetchEquityHistory).toHaveBeenCalledTimes(2);
  });

  it('returns null when the venue is not connected', async () => {
    const cache = new VenueEquityCache({ fetchEquityHistory: async () => null }, () => NOW);
    await expect(cache.get('acct_a', 'thalex')).resolves.toBeNull();
  });
});

describe('summarizeEquity', () => {
  it('skips unfunded leading days and returns null without a funded close', () => {
    expect(summarizeEquity([{ ts: NOW, equityUsd: 0 }], 'all', NOW)).toBeNull();
    expect(
      summarizeEquity(
        [
          { ts: NOW - 2 * DAY_MS, equityUsd: 0 },
          { ts: NOW - DAY_MS, equityUsd: 100 },
          { ts: NOW, equityUsd: 90 },
        ],
        'all',
        NOW,
      ),
    ).toMatchObject({ baselineUsd: 100, pnlUsd: -10, returnPct: -0.1 });
  });
});
