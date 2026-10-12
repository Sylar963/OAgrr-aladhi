import { describe, expect, it } from 'vitest';

import { chatReducer, INITIAL_CHAT_STATE } from './useSocialSocket';

const message = (id: string) => ({
  id,
  alias: 'anon-abc123',
  isAnon: true,
  body: id,
  createdAt: '2026-10-12T12:00:00.000Z',
  mine: false,
});

describe('chatReducer', () => {
  it('goes live on hello and applies history, messages and deletions', () => {
    let state = chatReducer(INITIAL_CHAT_STATE, {
      type: 'server',
      message: {
        type: 'hello',
        room: 'global',
        online: 3,
        handle: null,
        anonAlias: 'anon-abc123',
        mutedUntil: null,
      },
    });
    expect(state.connection).toBe('live');
    state = chatReducer(state, {
      type: 'server',
      message: { type: 'history', messages: [message('a'), message('b')] },
    });
    state = chatReducer(state, {
      type: 'server',
      message: { type: 'message', message: message('c') },
    });
    state = chatReducer(state, { type: 'server', message: { type: 'deleted', id: 'b' } });
    expect(state.messages.map((m) => m.id)).toEqual(['a', 'c']);
  });
});

describe('chatReducer trader stream', () => {
  const trader = {
    handle: 'theta',
    equityUsd: 100_500,
    pnlUsd: 500,
    returnPct: 0.005,
    openPositions: [],
    generatedAt: '2026-10-12T12:00:00.000Z',
    isMe: false,
    initialCashUsd: 100_000,
    startedAt: '2026-10-01T00:00:00.000Z',
    equityHistory: [
      { ts: '2026-10-01T00:00:00.000Z', equityUsd: 100_000 },
      { ts: '2026-10-12T12:00:00.000Z', equityUsd: 100_500 },
    ],
    closedTrades: [],
  };

  it('moves the live equity point on each live frame', () => {
    let state = chatReducer(INITIAL_CHAT_STATE, {
      type: 'server',
      message: { type: 'trader', trader },
    });
    state = chatReducer(state, {
      type: 'server',
      message: {
        type: 'trader_live',
        live: {
          ...trader,
          equityUsd: 101_000,
          pnlUsd: 1_000,
          returnPct: 0.01,
          generatedAt: '2026-10-12T12:00:02.000Z',
        },
      },
    });
    expect(state.trader?.equityUsd).toBe(101_000);
    expect(state.trader?.equityHistory.map((p) => p.equityUsd)).toEqual([100_000, 101_000]);
  });

  it('ignores live frames for another trader and clears on unavailable', () => {
    let state = chatReducer(INITIAL_CHAT_STATE, {
      type: 'server',
      message: { type: 'trader', trader },
    });
    const other = chatReducer(state, {
      type: 'server',
      message: { type: 'trader_live', live: { ...trader, handle: 'other', equityUsd: 1 } },
    });
    expect(other).toBe(state);
    state = chatReducer(state, {
      type: 'server',
      message: { type: 'trader_unavailable', handle: 'theta' },
    });
    expect(state.trader).toBeNull();
    expect(state.traderUnavailable).toBe('theta');
  });
});
