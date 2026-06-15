import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import websocket from '@fastify/websocket';

const { storeMock, getUserByTokenMock } = vi.hoisted(() => ({
  storeMock: { enabled: false as boolean },
  getUserByTokenMock: vi.fn(),
}));

vi.mock('../../trading-services.js', () => ({
  paperTradingStore: storeMock,
}));

vi.mock('../../user-service.js', () => ({
  getUserByToken: getUserByTokenMock,
}));

vi.mock('../../portfolio-services.js', () => ({
  bootstrapPortfolioForAccount: vi.fn().mockResolvedValue(undefined),
  getOrCreatePortfolioRuntime: vi.fn().mockReturnValue({
    getSnapshot: () => null,
    subscribe: () => () => {},
  }),
}));

vi.mock('./events.js', () => ({
  portfolioEvents: { subscribe: () => () => {} },
}));

import { portfolioWsRoute } from './ws.js';

const WS_CLOSED = 3;

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(websocket);
  await app.register(portfolioWsRoute);
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

describe('WS /ws/portfolio auth gate', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    storeMock.enabled = false;
    getUserByTokenMock.mockReset();
  });

  it('closes the connection when anonymous and persistence is enabled', async () => {
    storeMock.enabled = true;
    const ws = await app.injectWS('/ws/portfolio');
    expect(await waitForState(ws, WS_CLOSED)).toBe(WS_CLOSED);
  });

  it('closes the connection when token is invalid and persistence is enabled', async () => {
    storeMock.enabled = true;
    getUserByTokenMock.mockResolvedValue(null);

    const ws = await app.injectWS('/ws/portfolio?token=bogus');
    expect(await waitForState(ws, WS_CLOSED)).toBe(WS_CLOSED);
  });

  it('accepts authenticated connections and keeps them open', async () => {
    storeMock.enabled = true;
    getUserByTokenMock.mockResolvedValue({
      id: 'usr_bob',
      accountId: 'acct_bob',
      label: 'bob',
    });

    const ws = await app.injectWS('/ws/portfolio?token=k');
    await new Promise((r) => setTimeout(r, 100));

    expect(getUserByTokenMock).toHaveBeenCalledWith('k');
    expect(ws.readyState).not.toBe(WS_CLOSED);

    ws.terminate();
  });

  it('accepts anonymous connections (default account) when persistence is disabled', async () => {
    storeMock.enabled = false;
    const ws = await app.injectWS('/ws/portfolio');
    await new Promise((r) => setTimeout(r, 100));
    expect(ws.readyState).not.toBe(WS_CLOSED);
    ws.terminate();
  });
});
