import { describe, expect, it, vi } from 'vitest';

import type { Broadcaster } from './social-broadcast.js';
import { LeaderboardService } from './social-leaderboard.js';

const NOW = Date.parse('2026-10-12T12:00:00.000Z');
const DAY_MS = 86_400_000;
const LOG = { warn: vi.fn() };

const ALPHA: Broadcaster = {
  userId: 'usr_a',
  handle: 'alpha',
  accountId: 'acct_a',
  venue: 'derive',
  sharingSince: new Date('2026-10-01T00:00:00.000Z'),
};
const BETA: Broadcaster = {
  userId: 'usr_b',
  handle: 'beta',
  accountId: 'acct_b',
  venue: 'thalex',
  sharingSince: new Date('2026-10-09T00:00:00.000Z'),
};

const HISTORY: Record<string, Array<{ ts: number; equityUsd: number }>> = {
  acct_a: [
    { ts: NOW - 60 * DAY_MS, equityUsd: 10_000 },
    { ts: NOW - 8 * DAY_MS, equityUsd: 12_000 },
    { ts: NOW - DAY_MS, equityUsd: 12_600 },
  ],
  acct_b: [
    { ts: NOW - 20 * DAY_MS, equityUsd: 0 },
    { ts: NOW - 3 * DAY_MS, equityUsd: 5_000 },
    { ts: NOW - DAY_MS, equityUsd: 6_000 },
  ],
};

function create(members: Broadcaster[] = [ALPHA, BETA]) {
  const registry = { live: vi.fn(async () => members) };
  const equity = {
    get: vi.fn(async (accountId: string) => ({ fetchedAt: NOW, points: HISTORY[accountId] ?? [] })),
  };
  const service = new LeaderboardService(
    registry,
    equity,
    () => [],
    LOG,
    () => NOW,
  );
  return { service, registry, equity };
}

describe('LeaderboardService', () => {
  it('ranks venue equity growth from the first funded close and flags the viewer', async () => {
    const { service } = create();
    const result = await service.get('all', 'usr_a');
    expect(result.entries.map((e) => [e.rank, e.handle, e.venue, e.returnPct, e.isMe])).toEqual([
      [1, 'alpha', 'derive', 0.26, true],
      [2, 'beta', 'thalex', 0.2, false],
    ]);
    expect(result.entries[1]).toMatchObject({
      equityUsd: 6_000,
      since: new Date(NOW - 3 * DAY_MS).toISOString(),
      sharingSince: '2026-10-09T00:00:00.000Z',
    });
  });

  it('measures a period from the last close before it starts', async () => {
    const { service } = create();
    const result = await service.get('7d', null);
    expect(result.entries.map((e) => [e.handle, e.pnlUsd])).toEqual([
      ['beta', 1_000],
      ['alpha', 600],
    ]);
  });

  it('leaves out members whose history cannot be read', async () => {
    const { service, equity } = create();
    equity.get.mockImplementation(async (accountId: string) => {
      if (accountId === 'acct_b') throw new Error('venue down');
      return { fetchedAt: NOW, points: HISTORY[accountId] ?? [] };
    });
    const result = await service.get('all', null);
    expect(result.entries.map((e) => e.handle)).toEqual(['alpha']);
  });

  it('caches the member snapshot until invalidated', async () => {
    const { service, registry } = create();
    await service.get('all', null);
    await service.get('30d', null);
    expect(registry.live).toHaveBeenCalledTimes(1);
    service.invalidate();
    await service.get('all', null);
    expect(registry.live).toHaveBeenCalledTimes(2);
  });
});
