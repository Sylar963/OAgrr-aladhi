import { once } from 'node:events';
import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PRIVATE_SOCKET_LIFETIME_MS,
  protectWebSocket,
  registerPrivateWebSocket,
  revokePrivateWebSockets,
} from './websocket-security.js';

afterEach(() => vi.useRealTimers());

async function buildApp() {
  const app = Fastify();
  await app.register(websocket, { options: { maxPayload: 64 * 1024 } });
  app.get('/ws/:user', { websocket: true }, (socket, req) => {
    if (!protectWebSocket(socket, 'test-ip')) return;
    registerPrivateWebSocket((req.params as { user: string }).user, socket);
  });
  await app.ready();
  return app;
}

describe('websocket security', () => {
  it('revokes all connections belonging to a user without closing another user', async () => {
    const app = await buildApp();
    try {
      const a = await app.injectWS('/ws/a');
      const b = await app.injectWS('/ws/b');
      const closed = once(a, 'close');
      revokePrivateWebSockets('a');
      await closed;
      expect(a.readyState).toBe(3);
      expect(b.readyState).toBe(1);
      b.terminate();
    } finally {
      await app.close();
    }
  });

  it('requires periodic reauthentication', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const app = await buildApp();
    try {
      const socket = await app.injectWS('/ws/expiry');
      const closed = once(socket, 'close');
      await vi.advanceTimersByTimeAsync(PRIVATE_SOCKET_LIFETIME_MS);
      await closed;
      expect(socket.readyState).toBe(3);
    } finally {
      await app.close();
    }
  });

  it('closes a socket that floods messages', async () => {
    const app = await buildApp();
    try {
      const socket = await app.injectWS('/ws/flood');
      const closed = once(socket, 'close');
      for (let i = 0; i < 21; i += 1) socket.send('{}');
      await closed;
      expect(socket.readyState).toBe(3);
    } finally {
      await app.close();
    }
  });

  it('rejects oversized incoming frames', async () => {
    const app = await buildApp();
    try {
      const socket = await app.injectWS('/ws/payload');
      const closed = once(socket, 'close');
      socket.send('x'.repeat(64 * 1024 + 1));
      const [code] = await closed;
      expect(code).toBe(1009);
    } finally {
      await app.close();
    }
  });

  it('caps connections per IP and releases slots when clients disconnect', async () => {
    const app = await buildApp();
    try {
      const sockets = await Promise.all(
        Array.from({ length: 20 }, () => app.injectWS('/ws/quota')),
      );
      const rejected = await app.injectWS('/ws/quota');
      if (rejected.readyState !== 3) await once(rejected, 'close');
      expect(rejected.readyState).toBe(3);
      const closed = once(sockets[0]!, 'close');
      sockets[0]!.terminate();
      await closed;
      await new Promise<void>((resolve) => setImmediate(resolve));
      const replacement = await app.injectWS('/ws/quota');
      expect(replacement.readyState).toBe(1);
      replacement.terminate();
      for (const socket of sockets) socket.terminate();
    } finally {
      await app.close();
    }
  });
});
