import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import websocket from '@fastify/websocket';

const { storeMock, getUserByApiKeyMock } = vi.hoisted(() => ({
  storeMock: { enabled: false as boolean },
  getUserByApiKeyMock: vi.fn(),
}));

vi.mock('../../trading-services.js', () => ({
  paperTradingStore: storeMock,
  pnlService: { snapshot: vi.fn().mockResolvedValue({ cashUsd: 0, realizedUsd: 0, unrealizedUsd: 0, equityUsd: 0, totalReturnPct: 0 }) },
  positionRepository: { listPositions: vi.fn().mockResolvedValue([]) },
  quoteProvider: { getMark: vi.fn().mockResolvedValue(null) },
}));

vi.mock('../../user-service.js', () => ({
  getUserByApiKey: getUserByApiKeyMock,
}));

import { paperWsRoute } from './ws.js';

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(websocket);
  await app.register(paperWsRoute);
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
    getUserByApiKeyMock.mockReset();
  });

  it('rejects anonymous connections with unauthorized error when persistence is enabled', async () => {
    storeMock.enabled = true;
    const ws = await app.injectWS('/ws/paper');

    const msg = await readFirstMessage(ws);
    expect(msg['type']).toBe('error');
    expect(msg['code']).toBe('unauthorized');

    ws.terminate();
  });

  it('rejects connections with an invalid apiKey when persistence is enabled', async () => {
    storeMock.enabled = true;
    getUserByApiKeyMock.mockResolvedValue(null);

    const ws = await app.injectWS('/ws/paper?apiKey=does-not-exist');
    const msg = await readFirstMessage(ws);

    expect(msg['type']).toBe('error');
    expect(msg['code']).toBe('unauthorized');
    expect(getUserByApiKeyMock).toHaveBeenCalledWith('does-not-exist');

    ws.terminate();
  });

  it('accepts authenticated connections and binds to the user accountId', async () => {
    storeMock.enabled = true;
    getUserByApiKeyMock.mockResolvedValue({
      id: 'usr_abc',
      apiKey: 'good-key',
      accountId: 'acct_alice',
      label: 'alice',
      createdAt: new Date(),
    });

    const ws = await app.injectWS('/ws/paper?apiKey=good-key');
    const msg = await readFirstMessage(ws);

    expect(msg['type']).toBe('hello');
    expect(msg['accountId']).toBe('acct_alice');

    ws.terminate();
  });

  it('falls back to the default account when persistence is disabled (dev mode)', async () => {
    storeMock.enabled = false;
    const ws = await app.injectWS('/ws/paper');
    const msg = await readFirstMessage(ws);

    expect(msg['type']).toBe('hello');
    expect(msg['accountId']).toBe('paper-default');
    expect(getUserByApiKeyMock).not.toHaveBeenCalled();

    ws.terminate();
  });
});
