import type { PositionLeg } from '@oggregator/core';
import type { ChatServerMessage } from '@oggregator/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TraderStreamService } from './social-trader-stream.js';

const NOW = Date.parse('2026-10-12T12:00:00.000Z');
const DAY_MS = 86_400_000;

const TARGET = { userId: 'usr_t', accountId: 'acct_t', handle: 'theta', venue: 'derive' as const };

const LEG: PositionLeg = {
  legId: 'leg_1',
  underlying: 'BTC',
  expiry: '2026-12-25',
  strike: 100_000,
  optionRight: 'call',
  size: 1,
  entryPriceUsd: 1_000,
  entryIv: null,
  realizedPnlUsd: 0,
  entryTs: NOW - 5 * DAY_MS,
  venueHint: 'derive',
  source: 'derive',
  venueMarkPriceUsd: 1_500,
  venueMarkTs: NOW,
};

function viewer(userId: string) {
  const messages: ChatServerMessage[] = [];
  return { watcher: { userId, send: (m: ChatServerMessage) => messages.push(m) }, messages };
}

function deps(overrides: Partial<ConstructorParameters<typeof TraderStreamService>[0]> = {}) {
  return {
    isConnected: vi.fn(() => true),
    loadEquity: vi.fn(async () => ({
      fetchedAt: NOW,
      points: [
        { ts: NOW - 10 * DAY_MS, equityUsd: 10_000 },
        { ts: NOW - DAY_MS, equityUsd: 11_000 },
      ],
    })),
    listLegs: vi.fn(() => [LEG]),
    loadClosedTrades: vi.fn(async () => [
      {
        id: 'fill_1',
        underlying: 'BTC',
        expiry: '2026-11-27',
        strike: 90_000,
        optionRight: 'put' as const,
        direction: 'buy' as const,
        amount: 1,
        priceUsd: 200,
        realizedPnlUsd: 250,
        feeUsd: 1.5,
        closedAt: '2026-10-05T00:00:00.000Z',
      },
    ]),
    getMark: vi.fn(async () => 1_200),
    now: () => NOW,
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

  it('sends the venue account with its equity history and closing fills', async () => {
    const { service, d } = create();
    const { watcher, messages } = viewer('usr_v');
    await service.watch(watcher, TARGET);

    const full = messages[0];
    if (full?.type !== 'trader') throw new Error('expected trader frame');
    expect(full.trader).toMatchObject({
      handle: 'theta',
      venue: 'derive',
      isMe: false,
      equityUsd: 11_000,
      pnlUsd: 1_000,
      returnPct: 0.1,
      startedAt: new Date(NOW - 10 * DAY_MS).toISOString(),
      closedTradesAvailable: true,
      closedTrades: [{ id: 'fill_1', realizedPnlUsd: 250 }],
    });
    expect(full.trader.openPositions[0]).toMatchObject({
      netQuantity: 1,
      markPriceUsd: 1_500,
      unrealizedPnlUsd: 500,
    });
    expect(full.trader.equityHistory.map((p) => p.equityUsd)).toEqual([10_000, 11_000]);
    expect(d.getMark).not.toHaveBeenCalled();
  });

  it('falls back to the market mark when the venue has none', async () => {
    const { service } = create(
      deps({ listLegs: vi.fn(() => [{ ...LEG, venueMarkPriceUsd: null }]) }),
    );
    const { watcher, messages } = viewer('usr_v');
    await service.watch(watcher, TARGET);
    const full = messages[0];
    if (full?.type !== 'trader') throw new Error('expected trader frame');
    expect(full.trader.openPositions[0]?.markPriceUsd).toBe(1_200);
  });

  it('reports a member whose venue is not connected as waiting', async () => {
    const { service, d } = create(deps({ isConnected: vi.fn(() => false) }));
    const { watcher, messages } = viewer('usr_v');
    await service.watch(watcher, TARGET);
    expect(messages).toEqual([{ type: 'trader_unavailable', handle: 'theta', reason: 'waiting' }]);
    expect(d.loadEquity).not.toHaveBeenCalled();
  });

  it('marks Paradex-style accounts without fill history', async () => {
    const { service } = create(deps({ loadClosedTrades: vi.fn(async () => null) }));
    const { watcher, messages } = viewer('usr_v');
    await service.watch(watcher, { ...TARGET, venue: 'paradex' });
    const full = messages[0];
    if (full?.type !== 'trader') throw new Error('expected trader frame');
    expect(full.trader).toMatchObject({ closedTrades: [], closedTradesAvailable: false });
  });

  it('shares one load between watchers and re-marks from the venue store on ticks', async () => {
    const { service, d } = create();
    const a = viewer('usr_a');
    const b = viewer('usr_t');
    await service.watch(a.watcher, TARGET);
    await service.watch(b.watcher, TARGET);
    await service.tick();
    await service.tick();

    expect(d.loadEquity).toHaveBeenCalledTimes(1);
    expect(b.messages[0]?.type === 'trader' && b.messages[0].trader.isMe).toBe(true);
    expect(a.messages.filter((m) => m.type === 'trader_live')).toHaveLength(2);
  });

  it('re-reads fills after an account event and stops when the member leaves', async () => {
    vi.useFakeTimers();
    const { service, d } = create();
    const { watcher, messages } = viewer('usr_v');
    await service.watch(watcher, TARGET);

    service.onAccountEvent('acct_t', 'derive');
    service.onAccountEvent('acct_t', 'thalex');
    await vi.runOnlyPendingTimersAsync();
    expect(d.loadClosedTrades).toHaveBeenCalledTimes(2);
    expect(messages.filter((m) => m.type === 'trader')).toHaveLength(2);

    service.revoke('usr_t');
    expect(messages.at(-1)).toEqual({
      type: 'trader_unavailable',
      handle: 'theta',
      reason: 'left',
    });
    expect(service.watchedCount).toBe(0);
  });

  it('ends the stream as waiting when the venue disconnects', async () => {
    let connected = true;
    const { service } = create(deps({ isConnected: vi.fn(() => connected) }));
    const { watcher, messages } = viewer('usr_v');
    await service.watch(watcher, TARGET);
    connected = false;
    await service.tick();
    expect(messages.at(-1)).toEqual({
      type: 'trader_unavailable',
      handle: 'theta',
      reason: 'waiting',
    });
    expect(service.watchedCount).toBe(0);
  });

  it('keeps an unwatched book briefly, then drops it', async () => {
    let nowMs = NOW;
    const { service, d } = create(deps({ now: () => nowMs, idleRetentionMs: 60_000 }));
    const { watcher } = viewer('usr_v');
    await service.watch(watcher, TARGET);
    service.unwatch(watcher);
    await service.watch(watcher, TARGET);
    expect(d.loadEquity).toHaveBeenCalledTimes(1);

    service.unwatch(watcher);
    nowMs += 61_000;
    await service.tick();
    expect(service.watchedCount).toBe(0);
  });
});
