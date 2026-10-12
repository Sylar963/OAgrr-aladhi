import type { AccountBookRow } from '@oggregator/db';
import type { ChatServerMessage } from '@oggregator/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TraderStreamService } from './social-trader-stream.js';

const BOOK: AccountBookRow = {
  userId: 'usr_t',
  handle: 'theta',
  accountId: 'acct_t',
  initialCashUsd: 100_000,
  accountCreatedAt: new Date('2026-10-01T00:00:00.000Z'),
  cashUsd: 99_000,
  positions: [
    {
      underlying: 'BTC',
      expiry: '2026-12-25',
      strike: 100_000,
      optionRight: 'call',
      netQuantity: 1,
      avgEntryPriceUsd: 1_000,
    },
  ],
};

const TARGET = { userId: 'usr_t', accountId: 'acct_t', handle: 'theta' };

function viewer(userId: string) {
  const messages: ChatServerMessage[] = [];
  return { watcher: { userId, send: (m: ChatServerMessage) => messages.push(m) }, messages };
}

function deps(overrides: Partial<ConstructorParameters<typeof TraderStreamService>[0]> = {}) {
  return {
    loadBook: vi.fn(async () => BOOK),
    loadClosedTrades: vi.fn(async () => [
      {
        id: 'trd_1',
        underlying: 'BTC',
        label: 'Straddle',
        strategyName: 'long_straddle',
        openedAt: '2026-10-02T00:00:00.000Z',
        closedAt: '2026-10-05T00:00:00.000Z',
        realizedPnlUsd: 250,
        feesUsd: 4,
      },
    ]),
    loadEquityHistory: vi.fn(async () => [
      {
        accountId: 'acct_t',
        day: '2026-10-02',
        equityUsd: 100_500,
        capturedAt: new Date('2026-10-02T00:05:00.000Z'),
      },
    ]),
    getMark: vi.fn(async () => 1_500),
    now: () => Date.parse('2026-10-12T12:00:00.000Z'),
    reloadDebounceMs: 0,
    ...overrides,
  };
}

describe('TraderStreamService', () => {
  const services: TraderStreamService[] = [];
  afterEach(() => {
    for (const service of services.splice(0)) service.dispose();
    vi.useRealTimers();
  });

  function create(d = deps()) {
    const service = new TraderStreamService(d);
    services.push(service);
    return { service, d };
  }

  it('sends the full book with equity history ending at the live mark', async () => {
    const { service } = create();
    const { watcher, messages } = viewer('usr_v');
    await service.watch(watcher, TARGET);

    const full = messages[0];
    if (full?.type !== 'trader') throw new Error('expected trader frame');
    expect(full.trader).toMatchObject({
      handle: 'theta',
      isMe: false,
      equityUsd: 100_500,
      pnlUsd: 500,
      returnPct: 0.005,
      closedTrades: [{ id: 'trd_1', realizedPnlUsd: 250 }],
    });
    expect(full.trader.openPositions[0]).toMatchObject({
      markPriceUsd: 1_500,
      unrealizedPnlUsd: 500,
    });
    expect(full.trader.equityHistory.map((p) => p.equityUsd)).toEqual([100_000, 100_500, 100_500]);
  });

  it('shares one load between watchers and re-marks from memory on ticks', async () => {
    const { service, d } = create();
    const a = viewer('usr_a');
    const b = viewer('usr_t');
    await service.watch(a.watcher, TARGET);
    await service.watch(b.watcher, TARGET);
    await service.tick();
    await service.tick();

    expect(d.loadBook).toHaveBeenCalledTimes(1);
    expect(b.messages[0]?.type === 'trader' && b.messages[0].trader.isMe).toBe(true);
    expect(a.messages.filter((m) => m.type === 'trader_live')).toHaveLength(2);
  });

  it('reloads after the trader trades and stops streaming when they leave', async () => {
    vi.useFakeTimers();
    const { service, d } = create();
    const { watcher, messages } = viewer('usr_v');
    await service.watch(watcher, TARGET);

    service.onAccountEvent('acct_t');
    await vi.runOnlyPendingTimersAsync();
    expect(d.loadBook).toHaveBeenCalledTimes(2);
    expect(messages.filter((m) => m.type === 'trader')).toHaveLength(2);

    service.revoke('usr_t');
    expect(messages.at(-1)).toEqual({ type: 'trader_unavailable', handle: 'theta' });
    expect(service.watchedCount).toBe(0);
  });

  it('keeps an unwatched book briefly, then drops it', async () => {
    let nowMs = Date.parse('2026-10-12T12:00:00.000Z');
    const { service, d } = create(deps({ now: () => nowMs, idleRetentionMs: 60_000 }));
    const { watcher } = viewer('usr_v');
    await service.watch(watcher, TARGET);
    service.unwatch(watcher);
    await service.watch(watcher, TARGET);
    expect(d.loadBook).toHaveBeenCalledTimes(1);

    service.unwatch(watcher);
    nowMs += 61_000;
    await service.tick();
    expect(service.watchedCount).toBe(0);
  });
});
