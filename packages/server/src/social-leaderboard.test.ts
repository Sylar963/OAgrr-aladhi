import type { AccountBookRow, PaperEquitySnapshotRow } from '@oggregator/db';
import { describe, expect, it, vi } from 'vitest';

import { LeaderboardService, markBook } from './social-leaderboard.js';

const NOW = Date.parse('2026-10-12T12:00:00.000Z');

function book(overrides: Partial<AccountBookRow> = {}): AccountBookRow {
  return {
    userId: 'usr_a',
    handle: 'alpha',
    accountId: 'acct_a',
    initialCashUsd: 100_000,
    accountCreatedAt: new Date('2026-08-01T00:00:00.000Z'),
    cashUsd: 100_000,
    positions: [],
    ...overrides,
  };
}

const LONG_CALL = {
  underlying: 'BTC',
  expiry: '2026-12-25',
  strike: 100_000,
  optionRight: 'call' as const,
  netQuantity: 1,
  avgEntryPriceUsd: 1_000,
};

describe('markBook', () => {
  it('values unmarked legs at entry price instead of zero', async () => {
    const shortPut = { ...LONG_CALL, optionRight: 'put' as const, netQuantity: -2 };
    const marked = await markBook(
      book({ cashUsd: 102_000, positions: [shortPut] }),
      async () => null,
    );
    expect(marked.equityUsd).toBe(100_000);
    expect(marked.unmarkedPositions).toBe(1);
  });
});

describe('LeaderboardService', () => {
  function store(books: AccountBookRow[], baselines: PaperEquitySnapshotRow[] = []) {
    return {
      listAccountBooks: vi.fn(async () => books),
      listEquityBaselines: vi.fn(async () => baselines),
    };
  }

  it('ranks all-time return against initial cash and flags the viewer', async () => {
    const fake = store([
      book(),
      book({ userId: 'usr_b', handle: 'beta', accountId: 'acct_b', positions: [LONG_CALL] }),
    ]);
    const service = new LeaderboardService(
      fake,
      async () => 1_500,
      () => NOW,
    );
    const result = await service.get('all', 'usr_a');
    expect(result.entries.map((e) => [e.rank, e.handle, e.returnPct, e.isMe])).toEqual([
      [1, 'beta', 0.015, false],
      [2, 'alpha', 0, true],
    ]);
  });

  it('uses snapshots for older accounts and initial cash for accounts reset in the window', async () => {
    const fake = store(
      [
        book({ cashUsd: 110_000 }),
        book({
          userId: 'usr_new',
          handle: 'fresh',
          accountId: 'acct_new',
          accountCreatedAt: new Date('2026-10-10T00:00:00.000Z'),
          cashUsd: 105_000,
        }),
        book({ userId: 'usr_old', handle: 'nohistory', accountId: 'acct_old' }),
      ],
      [
        {
          accountId: 'acct_a',
          day: '2026-10-05',
          equityUsd: 100_000,
          capturedAt: new Date('2026-10-05T00:05:00.000Z'),
        },
      ],
    );
    const service = new LeaderboardService(
      fake,
      async () => null,
      () => NOW,
    );
    const result = await service.get('7d', null);
    expect(result.entries.map((e) => [e.handle, e.pnlUsd])).toEqual([
      ['alpha', 10_000],
      ['fresh', 5_000],
    ]);
    expect(fake.listEquityBaselines).toHaveBeenCalledWith(['acct_a', 'acct_old'], '2026-10-05');
  });

  it('caches books until invalidated', async () => {
    const fake = store([book()]);
    const service = new LeaderboardService(
      fake,
      async () => null,
      () => NOW,
    );
    await service.get('all', null);
    await service.get('all', null);
    expect(fake.listAccountBooks).toHaveBeenCalledTimes(1);
    service.invalidate();
    await service.get('all', null);
    expect(fake.listAccountBooks).toHaveBeenCalledTimes(2);
  });
});
