import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import websocket from '@fastify/websocket';

const { storeMock, getUserByApiKeyMock } = vi.hoisted(() => ({
  storeMock: { enabled: false as boolean },
  getUserByApiKeyMock: vi.fn(),
}));

vi.mock('../../trading-services.js', () => ({
  paperTradingStore: storeMock,
}));

vi.mock('../../user-service.js', () => ({
  getUserByApiKey: getUserByApiKeyMock,
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

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(websocket);
  await app.register(portfolioWsRoute);
  await app.ready();
  return app;
}

function readFirstMessage(ws: { on: (event: string, cb: (data: unknown) => void) => void }): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout waiting for ws message')), 1000);
    ws.on('message', (raw) => {
      clearTimeout(timer);
      resolve(JSON.parse(String(raw)) as Record<string, unknown>);
    });
  });
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
    getUserByApiKeyMock.mockReset();
  });

  it('rejects anonymous connections when persistence is enabled', async () => {
    storeMock.enabled = true;
    const ws = await app.injectWS('/ws/portfolio');
    const msg = await readFirstMessage(ws);

    expect(msg['type']).toBe('error');
    expect(msg['code']).toBe('unauthorized');

    ws.terminate();
  });

  it('rejects invalid apiKey when persistence is enabled', async () => {
    storeMock.enabled = true;
    getUserByApiKeyMock.mockResolvedValue(null);

    const ws = await app.injectWS('/ws/portfolio?apiKey=bogus');
    const msg = await readFirstMessage(ws);

    expect(msg['type']).toBe('error');
    expect(msg['code']).toBe('unauthorized');

    ws.terminate();
  });

  it('accepts authenticated connections and routes them to the user accountId', async () => {
    storeMock.enabled = true;
    getUserByApiKeyMock.mockResolvedValue({
      id: 'usr_bob',
      apiKey: 'k',
      accountId: 'acct_bob',
      label: 'bob',
      createdAt: new Date(),
    });

    const ws = await app.injectWS('/ws/portfolio?apiKey=k');
    const msg = await readFirstMessage(ws);

    expect(msg['type']).toBe('hello');
    expect(msg['accountId']).toBe('acct_bob');

    ws.terminate();
  });

  it('allows anonymous connections (default account) when persistence is disabled', async () => {
    storeMock.enabled = false;
    const ws = await app.injectWS('/ws/portfolio');
    const msg = await readFirstMessage(ws);

    expect(msg['type']).toBe('hello');
    expect(msg['accountId']).toBe('paper-default');

    ws.terminate();
  });
});
