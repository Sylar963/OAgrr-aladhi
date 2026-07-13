import websocket from '@fastify/websocket';
import type { TradeEvent } from '@oggregator/core';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';

import { flowService, tradeStore } from '../services.js';
import { wsInstrumentTradesRoute } from './ws-instrument-trades.js';

const instrument = 'BTC-27MAR26-70000-C';
let app: ReturnType<typeof Fastify>;
let baseUrl: string;
let listener: ((trade: TradeEvent) => void) | null;
let release: ReturnType<typeof vi.fn>;
let unsubscribe: ReturnType<typeof vi.fn>;

function trade(overrides: Partial<TradeEvent> = {}): TradeEvent {
  return {
    venue: 'deribit',
    tradeId: '1',
    instrument,
    underlying: 'BTC',
    side: 'buy',
    price: 0.01,
    size: 1,
    iv: 0.5,
    markPrice: 0.01,
    indexPrice: 70_000,
    isBlock: false,
    timestamp: 1_700_000_000_000,
    ...overrides,
  };
}

beforeAll(async () => {
  app = Fastify({ logger: false });
  await app.register(websocket);
  await app.register(wsInstrumentTradesRoute);
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  baseUrl = address.replace(/^http/, 'ws');
});

beforeEach(() => {
  listener = null;
  release = vi.fn();
  unsubscribe = vi.fn();
  vi.spyOn(flowService, 'acquire').mockResolvedValue(release);
  vi.spyOn(flowService, 'getTrades').mockReturnValue([
    trade(),
    trade({ tradeId: 'other-venue', venue: 'okx' }),
    trade({ tradeId: 'other-instrument', instrument: 'BTC-27MAR26-80000-C' }),
  ]);
  vi.spyOn(flowService, 'subscribe').mockImplementation((nextListener) => {
    listener = nextListener;
    return unsubscribe;
  });
  vi.spyOn(tradeStore, 'loadHistory');
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await app.close();
});

describe('WS /ws/instrument-trades', () => {
  it('sends matching runtime trades without reading database history', async () => {
    const params = new URLSearchParams({ underlying: 'BTC', venue: 'deribit', instrument });
    const socket = new WebSocket(`${baseUrl}/ws/instrument-trades?${params.toString()}`);
    const messages = collectMessages(socket, 2);

    await waitForOpen(socket);
    listener?.(trade({ tradeId: '2', timestamp: 1_700_000_001_000 }));
    const [snapshot, live] = await messages;

    expect(snapshot?.['type']).toBe('snapshot');
    expect(snapshot?.['trades']).toHaveLength(1);
    expect(live?.['type']).toBe('trade');
    expect(tradeStore.loadHistory).not.toHaveBeenCalled();

    socket.close();
    await waitForClose(socket);
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
  });

  it('rejects an invalid venue before acquiring the runtime', async () => {
    const params = new URLSearchParams({ underlying: 'BTC', venue: 'unknown', instrument });
    const socket = new WebSocket(`${baseUrl}/ws/instrument-trades?${params.toString()}`);
    const messages = collectMessages(socket, 1);

    const [error] = await messages;

    expect(error?.['type']).toBe('error');
    expect(error?.['code']).toBe('INVALID_QUERY');
    expect(flowService.acquire).not.toHaveBeenCalled();
    await waitForClose(socket);
  });
});

function collectMessages(
  socket: WebSocket,
  count: number,
): Promise<Array<Record<string, unknown>>> {
  return new Promise((resolve, reject) => {
    const messages: Array<Record<string, unknown>> = [];
    const timer = setTimeout(
      () => reject(new Error('Timed out waiting for WebSocket messages')),
      2_000,
    );
    socket.on('message', (raw) => {
      messages.push(JSON.parse(raw.toString()) as Record<string, unknown>);
      if (messages.length !== count) return;
      clearTimeout(timer);
      resolve(messages);
    });
  });
}

function waitForOpen(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.OPEN) return Promise.resolve();
  return new Promise((resolve) => socket.once('open', resolve));
}

function waitForClose(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) return Promise.resolve();
  return new Promise((resolve) => socket.once('close', resolve));
}
