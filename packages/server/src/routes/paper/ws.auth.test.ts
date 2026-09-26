import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import { once } from 'node:events';
import { revokePrivateWebSockets } from '../../websocket-security.js';

const { storeMock, consumeWebSocketTicketMock, listPositionsMock, getCashBalanceMock } = vi.hoisted(
  () => ({
    storeMock: { enabled: false as boolean },
    consumeWebSocketTicketMock: vi.fn(),
    listPositionsMock: vi.fn().mockReturnValue([]),
    getCashBalanceMock: vi.fn().mockReturnValue(0),
  }),
);

vi.mock('../../trading-services.js', () => ({
  paperTradingStore: storeMock,
  positionRepository: {
    listPositions: listPositionsMock,
    getCashBalance: getCashBalanceMock,
  },
  quoteProvider: { getMark: vi.fn().mockReturnValue(null) },
}));

vi.mock('../../websocket-ticket-service.js', () => ({
  consumeWebSocketTicket: consumeWebSocketTicketMock,
}));

import { paperWsRoute } from './ws.js';

const WS_CLOSED = 3;

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(websocket);
  await app.register(paperWsRoute);
  await app.ready();
  return app;
}

async function waitForState(
  ws: { readyState: number },
  target: number,
  timeoutMs = 500,
): Promise<number> {
  const start = Date.now();
  while (ws.readyState !== target && Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 10));
  }
  return ws.readyState;
}

describe('WS /ws/paper auth gate', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    storeMock.enabled = false;
    consumeWebSocketTicketMock.mockReset();
    listPositionsMock.mockClear();
    getCashBalanceMock.mockClear();
  });

  it('closes an already authenticated socket when the user signs out', async () => {
    storeMock.enabled = true;
    consumeWebSocketTicketMock.mockReturnValue({ id: 'logout-paper', accountId: 'acct_logout' });
    const ws = await app.injectWS('/ws/paper?ticket=logout');
    const closed = once(ws, 'close');
    revokePrivateWebSockets('logout-paper');
    await closed;
    expect(ws.readyState).toBe(WS_CLOSED);
  });

  it('closes the connection without a hello when anonymous and persistence is enabled', async () => {
    storeMock.enabled = true;
    const ws = await app.injectWS('/ws/paper');
    expect(await waitForState(ws, WS_CLOSED)).toBe(WS_CLOSED);
  });

  it('closes the connection when ticket is invalid and persistence is enabled', async () => {
    storeMock.enabled = true;
    consumeWebSocketTicketMock.mockReturnValue(null);

    const ws = await app.injectWS('/ws/paper?ticket=does-not-exist');
    expect(await waitForState(ws, WS_CLOSED)).toBe(WS_CLOSED);
    expect(consumeWebSocketTicketMock).toHaveBeenCalledWith('does-not-exist');
  });

  it('accepts authenticated connections and keeps them open', async () => {
    storeMock.enabled = true;
    consumeWebSocketTicketMock.mockReturnValue({
      id: 'usr_abc',
      accountId: 'acct_alice',
      label: 'alice',
    });

    const ws = await app.injectWS('/ws/paper?ticket=good-ticket');
    await new Promise((r) => setTimeout(r, 100));

    expect(consumeWebSocketTicketMock).toHaveBeenCalledWith('good-ticket');
    expect(ws.readyState).not.toBe(WS_CLOSED);

    ws.terminate();
  });

  it('accepts anonymous connections (default account) when persistence is disabled', async () => {
    storeMock.enabled = false;
    const ws = await app.injectWS('/ws/paper');
    await new Promise((r) => setTimeout(r, 100));
    expect(ws.readyState).not.toBe(WS_CLOSED);
    expect(consumeWebSocketTicketMock).not.toHaveBeenCalled();
    ws.terminate();
  });

  it('reuses cached account state for periodic snapshots', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const ws = await app.injectWS('/ws/paper');

    try {
      await vi.waitFor(() => {
        expect(listPositionsMock).toHaveBeenCalledOnce();
        expect(getCashBalanceMock).toHaveBeenCalledOnce();
      });

      await vi.advanceTimersByTimeAsync(5_000);

      expect(listPositionsMock).toHaveBeenCalledOnce();
      expect(getCashBalanceMock).toHaveBeenCalledOnce();
    } finally {
      ws.terminate();
      vi.useRealTimers();
    }
  });
});
