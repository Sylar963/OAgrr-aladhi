import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type ExecutionEnvelope,
  ExecutionEnvelopeSchema,
  type ExecutionResponse,
  type LiveStatus,
} from '@oggregator/protocol';
import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExecutionClient, type ExecutionResult } from '../../execution-client.js';
import type { AuthenticatedUser } from '../../user-service.js';
import { liveRoutes } from './index.js';

const status: LiveStatus = {
  state: 'disarmed',
  killedReason: null,
  keyBound: true,
  tradingKeys: [],
  venue: { name: 'stub', connected: false },
  alerts: { telegramConfigured: true, emailConfigured: true, testDelivered: true },
  journal: { lastSeq: 3, chainOk: true },
};

const operator: AuthenticatedUser = {
  id: 'usr_1',
  clerkUserId: 'user_1',
  accountId: 'acct_1',
  label: 'Operator',
  factorAgeMinutes: { first: 1, second: 1 },
};

async function buildApp(options: {
  client?: { send: ReturnType<typeof vi.fn> } | null;
  user?: AuthenticatedUser;
}) {
  const app = Fastify({ logger: false });
  await app.register(liveRoutes, {
    prefix: '/api',
    env: { LIVE_TRADING_ENABLED: 'true' },
    client: options.client === undefined ? null : options.client,
    authenticate: async () => options.user ?? operator,
    entitlements: {
      enabled: true,
      getUserEntitlement: async () => ({ status: 'enabled', expiresAt: null }),
    },
  });
  await app.ready();
  return app;
}

function client(result: ExecutionResult) {
  return { send: vi.fn(async () => result) };
}

describe('/api/live routes', () => {
  it('sends a global kill with the verified actor and no step-up', async () => {
    const c = client({ ok: true, status: { ...status, state: 'killed' } });
    const app = await buildApp({
      client: c,
      user: { ...operator, factorAgeMinutes: { first: 60, second: null } },
    });

    const res = await app.inject({ method: 'POST', url: '/api/live/kill', payload: {} });

    expect(res.statusCode).toBe(200);
    expect(res.json().state).toBe('killed');
    expect(c.send).toHaveBeenCalledWith(
      { clerkUserId: 'user_1', accountId: 'acct_1' },
      { type: 'kill', scope: { kind: 'global' }, reason: 'Kill switch from the terminal' },
      expect.any(String),
    );
  });

  it('requires step-up to arm and reset', async () => {
    const c = client({ ok: true, status });
    const app = await buildApp({
      client: c,
      user: { ...operator, factorAgeMinutes: { first: 1, second: null } },
    });

    expect((await app.inject({ method: 'POST', url: '/api/live/arm' })).statusCode).toBe(403);
    expect(
      (await app.inject({ method: 'POST', url: '/api/live/reset', payload: { reason: 'ok' } }))
        .statusCode,
    ).toBe(403);
    expect(c.send).not.toHaveBeenCalled();
  });

  it('maps daemon errors to HTTP statuses', async () => {
    const app = await buildApp({
      client: client({ ok: false, error: { code: 'not_bound', message: 'No key' } }),
    });
    const res = await app.inject({ method: 'POST', url: '/api/live/arm' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'not_bound', message: 'No key' });
  });

  it('returns 503 when the daemon is not configured or unreachable', async () => {
    const none = await buildApp({ client: null });
    expect((await none.inject({ method: 'GET', url: '/api/live/status' })).statusCode).toBe(503);

    const down = await buildApp({ client: client({ unavailable: true, reason: 'ENOENT' }) });
    const res = await down.inject({ method: 'POST', url: '/api/live/kill', payload: {} });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: 'execution_unavailable', reason: 'ENOENT' });
  });

  it('passes a client-supplied idempotency key and rejects malformed ones', async () => {
    const c = client({ ok: true, status });
    const app = await buildApp({ client: c });
    const key = randomUUID();

    await app.inject({
      method: 'POST',
      url: '/api/live/disarm',
      headers: { 'idempotency-key': key },
      payload: { reason: 'done' },
    });
    expect(c.send.mock.calls[0]![2]).toBe(key);

    const bad = await app.inject({
      method: 'POST',
      url: '/api/live/disarm',
      headers: { 'idempotency-key': 'not-a-uuid' },
      payload: { reason: 'done' },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('validates the kill scope', async () => {
    const app = await buildApp({ client: client({ ok: true, status }) });
    const res = await app.inject({
      method: 'POST',
      url: '/api/live/kill',
      payload: { scope: { kind: 'everything' } },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('ExecutionClient', () => {
  const dirs: string[] = [];
  const servers: Server[] = [];
  afterEach(async () => {
    for (const s of servers.splice(0)) await new Promise((r) => s.close(() => r(undefined)));
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  async function fakeDaemon(respond: (envelope: ExecutionEnvelope) => ExecutionResponse | string) {
    const dir = mkdtempSync(join(tmpdir(), 'ogg-exec-client-'));
    dirs.push(dir);
    const path = join(dir, 'exec.sock');
    const received: ExecutionEnvelope[] = [];
    const server = createServer((socket) => {
      socket.setEncoding('utf8');
      socket.on('data', (chunk: string) => {
        const envelope = ExecutionEnvelopeSchema.parse(JSON.parse(chunk.trim()));
        received.push(envelope);
        const out = respond(envelope);
        socket.write(`${typeof out === 'string' ? out : JSON.stringify(out)}\n`);
      });
    });
    servers.push(server);
    await new Promise<void>((r) => server.listen(path, () => r()));
    return { path, received };
  }

  it('signs requests with increasing nonces and parses the response', async () => {
    const daemon = await fakeDaemon(() => ({ ok: true, status }));
    const c = new ExecutionClient({ socketPath: daemon.path, hmacKey: Buffer.alloc(32, 1), now: () => 1_000 });

    const first = await c.send({ clerkUserId: 'u', accountId: 'a' }, { type: 'status' });
    await c.send({ clerkUserId: 'u', accountId: 'a' }, { type: 'status' });

    expect(first).toEqual({ ok: true, status });
    expect(daemon.received[1]!.nonce).toBeGreaterThan(daemon.received[0]!.nonce);
    expect(daemon.received[0]!.hmac).toMatch(/^[a-f0-9]{64}$/);
  });

  it('reports unavailable on a missing socket or a bad response', async () => {
    const missing = new ExecutionClient({ socketPath: '/nonexistent/exec.sock', hmacKey: Buffer.alloc(32) });
    expect(await missing.send({ clerkUserId: 'u', accountId: 'a' }, { type: 'status' })).toMatchObject({
      unavailable: true,
    });

    const daemon = await fakeDaemon(() => '{"weird":true}');
    const c = new ExecutionClient({ socketPath: daemon.path, hmacKey: Buffer.alloc(32) });
    expect(await c.send({ clerkUserId: 'u', accountId: 'a' }, { type: 'status' })).toEqual({
      unavailable: true,
      reason: 'invalid_response',
    });
  });
});
