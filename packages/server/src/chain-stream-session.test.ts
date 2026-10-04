import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChainRuntimeEvent, WsSubscriptionRequest } from '@oggregator/core';

const subscribeMock = vi.fn();
const releaseMock = vi.fn(async () => {});
const getSnapshotMock = vi.fn();
const getActiveRequestMock = vi.fn();
const getFailedVenuesMock = vi.fn(() => []);

vi.mock('./chain-engines.js', () => ({
  chainEngines: {
    acquire: vi.fn(async () => ({
      runtime: {
        subscribe: subscribeMock,
        getSnapshot: getSnapshotMock,
        getActiveRequest: getActiveRequestMock,
        getFailedVenues: getFailedVenuesMock,
      },
      release: releaseMock,
    })),
  },
}));

import { ChainStreamSession } from './chain-stream-session.js';

function makeRequest(): WsSubscriptionRequest {
  return {
    underlying: 'BTC',
    expiry: '2026-03-27',
    venues: ['deribit'],
  };
}

describe('ChainStreamSession', () => {
  beforeEach(() => {
    subscribeMock.mockReset();
    releaseMock.mockClear();
    getSnapshotMock.mockReset();
    getActiveRequestMock.mockReset();
    getFailedVenuesMock.mockReset();
    getFailedVenuesMock.mockReturnValue([]);
    getActiveRequestMock.mockImplementation(() => makeRequest());
    getSnapshotMock.mockReturnValue(null);
  });

  it('waits for sustained backpressure before closing the socket', async () => {
    vi.useFakeTimers();
    let listener: { onEvent(event: ChainRuntimeEvent): void } | null = null;
    subscribeMock.mockImplementation(
      (nextListener: { onEvent(event: ChainRuntimeEvent): void }) => {
        listener = nextListener;
        return vi.fn();
      },
    );

    const socket = {
      readyState: 1,
      bufferedAmount: 1_000_000,
      send: vi.fn(),
      close: vi.fn(),
    };

    const session = new ChainStreamSession(socket, 'sub-1', makeRequest());
    await session.subscribe();

    listener?.onEvent({
      type: 'status',
      status: {
        venue: 'deribit',
        state: 'connected',
        ts: Date.now(),
      },
    });

    expect(socket.close).not.toHaveBeenCalled();
    expect(releaseMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(15_000);

    listener?.onEvent({
      type: 'status',
      status: {
        venue: 'deribit',
        state: 'connected',
        ts: Date.now(),
      },
    });

    expect(socket.close).toHaveBeenCalledWith(1013, 'slow client');
    expect(releaseMock).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('drops oversized deltas and resyncs with a snapshot after backpressure clears', async () => {
    let listener: { onEvent(event: ChainRuntimeEvent): void } | null = null;
    subscribeMock.mockImplementation(
      (nextListener: { onEvent(event: ChainRuntimeEvent): void }) => {
        listener = nextListener;
        return vi.fn();
      },
    );

    const socket = {
      readyState: 1,
      bufferedAmount: 600_000,
      send: vi.fn(),
      close: vi.fn(),
    };

    const session = new ChainStreamSession(socket, 'sub-1', makeRequest());
    await session.subscribe();

    listener?.onEvent({
      type: 'delta',
      seq: 1,
      request: makeRequest(),
      meta: { generatedAt: 1, maxQuoteTs: 1, staleMs: 0 },
      deltas: [],
      patch: {
        stats: {
          forwardPriceUsd: null,
          indexPriceUsd: null,
          basisPct: null,
          atmStrike: null,
          atmIv: null,
          putCallOiRatio: null,
          totalOiUsd: null,
          skew25d: null,
          bfly25d: null,
        },
        strikes: [],
        gex: [],
      },
    });

    expect(socket.send).toHaveBeenCalledTimes(1);

    getSnapshotMock.mockReturnValue({
      type: 'snapshot',
      seq: 2,
      request: makeRequest(),
      meta: { generatedAt: 2, maxQuoteTs: 2, staleMs: 0 },
      data: {
        underlying: 'BTC',
        expiry: '2026-03-27',
        expiryTs: null,
        dte: 1,
        stats: {
          forwardPriceUsd: null,
          indexPriceUsd: null,
          basisPct: null,
          atmStrike: null,
          atmIv: null,
          putCallOiRatio: null,
          totalOiUsd: null,
          skew25d: null,
          bfly25d: null,
        },
        strikes: [],
        gex: [],
      },
    });
    socket.bufferedAmount = 0;

    listener?.onEvent({
      type: 'status',
      status: {
        venue: 'deribit',
        state: 'connected',
        ts: Date.now(),
      },
    });

    expect(socket.send).toHaveBeenCalledTimes(3);
    expect(JSON.parse(socket.send.mock.calls[1]![0])).toMatchObject({ type: 'snapshot', seq: 2 });
  });

  it('suppresses duplicate stale status logs when only elapsed time changes', async () => {
    let listener: { onEvent(event: ChainRuntimeEvent): void } | null = null;
    subscribeMock.mockImplementation(
      (nextListener: { onEvent(event: ChainRuntimeEvent): void }) => {
        listener = nextListener;
        return vi.fn();
      },
    );

    const socket = {
      readyState: 1,
      bufferedAmount: 0,
      send: vi.fn(),
      close: vi.fn(),
    };
    const log = { info: vi.fn(), warn: vi.fn() };

    const session = new ChainStreamSession(socket, 'sub-1', makeRequest(), log);
    await session.subscribe();

    listener?.onEvent({
      type: 'status',
      status: { venue: 'deribit', state: 'degraded', ts: 1, message: 'stale for 1000ms' },
    });
    listener?.onEvent({
      type: 'status',
      status: { venue: 'deribit', state: 'degraded', ts: 2, message: 'stale for 2000ms' },
    });

    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  it('forwards runtime GEX on every delta that carries it', async () => {
    let listener: { onEvent(event: ChainRuntimeEvent): void } | null = null;
    subscribeMock.mockImplementation(
      (nextListener: { onEvent(event: ChainRuntimeEvent): void }) => {
        listener = nextListener;
        return vi.fn();
      },
    );

    const socket = { readyState: 1, bufferedAmount: 0, send: vi.fn(), close: vi.fn() };
    const session = new ChainStreamSession(socket, 'sub-1', makeRequest());
    await session.subscribe();

    const stats = {
      forwardPriceUsd: null,
      indexPriceUsd: null,
      basisPct: null,
      atmStrike: null,
      atmIv: null,
      putCallOiRatio: null,
      totalOiUsd: null,
      skew25d: null,
      bfly25d: null,
    };
    const delta = (seq: number, withGex: boolean): ChainRuntimeEvent => ({
      type: 'delta',
      seq,
      request: makeRequest(),
      meta: { generatedAt: seq, maxQuoteTs: seq, staleMs: 0 },
      deltas: [],
      patch: withGex ? { stats, strikes: [], gex: [] } : { stats, strikes: [] },
    });

    listener?.onEvent(delta(1, false));
    listener?.onEvent(delta(2, true));
    listener?.onEvent(delta(3, true));

    const patches = socket.send.mock.calls
      .map(([payload]) => JSON.parse(payload as string))
      .filter((message) => message.type === 'delta')
      .map((message) => message.patch);
    expect(patches.map((patch) => 'gex' in patch)).toEqual([false, true, true]);
  });

  it('shares the serialized body across sessions while keeping per-session envelopes', async () => {
    const listeners: Array<{ onEvent(event: ChainRuntimeEvent): void }> = [];
    subscribeMock.mockImplementation((nextListener: { onEvent(event: ChainRuntimeEvent): void }) => {
      listeners.push(nextListener);
      return vi.fn();
    });

    const log = { info: vi.fn(), warn: vi.fn() };
    const sockets = [1, 2].map(() => ({ readyState: 1, bufferedAmount: 0, send: vi.fn(), close: vi.fn() }));
    for (const [index, socket] of sockets.entries()) {
      await new ChainStreamSession(socket, `sub-${index}`, makeRequest(), log).subscribe();
    }

    const stats = {
      forwardPriceUsd: 70_000,
      indexPriceUsd: null,
      basisPct: null,
      atmStrike: null,
      atmIv: null,
      putCallOiRatio: null,
      totalOiUsd: null,
      skew25d: null,
      bfly25d: null,
    };
    const strikes = Array.from({ length: 4_000 }, (_, index) => ({
      strike: index,
      call: { venues: {}, bestIv: 0.5, bestVenue: null },
      put: { venues: {}, bestIv: 0.5, bestVenue: null },
    }));
    const event: ChainRuntimeEvent = {
      type: 'delta',
      seq: 1,
      request: makeRequest(),
      meta: { generatedAt: 1, maxQuoteTs: 1, staleMs: 0 },
      deltas: [],
      patch: { stats, strikes, gex: [] },
    };
    for (const listener of listeners) listener.onEvent(event);

    const payloads = sockets.map((socket) => socket.send.mock.calls.at(-1)![0] as string);
    const parsed = payloads.map((payload) => JSON.parse(payload));
    expect(parsed.map((message) => message.subscriptionId)).toEqual(['sub-0', 'sub-1']);
    expect(parsed[0].patch).toEqual(JSON.parse(JSON.stringify(event.patch)));
    expect(parsed[1].patch).toEqual(parsed[0].patch);

    const largeFrameLog = log.info.mock.calls.find(([, msg]) => msg === 'chain ws large frame');
    expect(largeFrameLog?.[0]).toMatchObject({ bytes: Buffer.byteLength(payloads[0]!) });
  });
});
