import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExecutionCommand, ExecutionResponse } from '@oggregator/protocol';
import pino from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExecutionConfig } from './config.js';
import { JournalCorruptError, type RunningDaemon, startDaemon } from './daemon.js';
import { Journal } from './journal.js';
import { signEnvelope } from './signing.js';
import type { StubVenueGateway } from './venue-gateway.js';

const dirs: string[] = [];
const running: RunningDaemon[] = [];
afterEach(async () => {
  for (const d of running.splice(0)) await d.stop('test');
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function config(): ExecutionConfig {
  const dir = mkdtempSync(join(tmpdir(), 'ogg-daemon-'));
  dirs.push(dir);
  return {
    socketPath: join(dir, 'exec.sock'),
    hmacKey: Buffer.alloc(32, 3),
    stateDir: join(dir, 'state'),
    keyEncryptionKey: Buffer.alloc(32, 4),
    keyId: 'k1',
    venue: 'stub',
    telegram: { botToken: 'tg', chatId: '1' },
    email: { apiKey: 're', from: 'a@example.com', to: 'b@example.com' },
    logLevel: 'silent',
  };
}

function send(cfg: ExecutionConfig, command: ExecutionCommand): Promise<ExecutionResponse> {
  const envelope = signEnvelope(
    {
      command,
      actor: { clerkUserId: 'user_1', accountId: 'acct_1' },
      idempotencyKey: randomUUID(),
      nonce: Date.now(),
      ts: Date.now(),
    },
    cfg.hmacKey,
  );
  return new Promise((resolve, reject) => {
    const socket = connect(cfg.socketPath, () => socket.write(`${JSON.stringify(envelope)}\n`));
    socket.setEncoding('utf8');
    let buffer = '';
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      if (buffer.includes('\n')) {
        socket.end();
        resolve(JSON.parse(buffer.trim()) as ExecutionResponse);
      }
    });
    socket.on('error', reject);
  });
}

describe('execution daemon', () => {
  it('kills end to end: socket → control → gateway → journal → both alert sinks', async () => {
    const cfg = config();
    const fetchFn = vi.fn(async () => new Response('{}', { status: 200 }));
    const daemon = await startDaemon(cfg, pino({ level: 'silent' }), fetchFn);
    running.push(daemon);

    const response = await send(cfg, { type: 'kill', scope: { kind: 'global' }, reason: 'drill' });

    expect(response).toMatchObject({ ok: true, status: { state: 'killed', killedReason: 'drill' } });
    expect((daemon.gateway as StubVenueGateway).kills).toEqual([{ kind: 'global' }]);
    expect(daemon.journal.lastOfType(['killed'])?.actor).toBe('user_1/acct_1');
    const urls = fetchFn.mock.calls.map((call) => (call as unknown as [string])[0]);
    expect(urls.filter((u) => u.includes('api.telegram.org')).length).toBeGreaterThanOrEqual(2);
    expect(urls.filter((u) => u.includes('api.resend.com')).length).toBeGreaterThanOrEqual(2);
  });

  it('refuses to arm without a bound key', async () => {
    const cfg = config();
    const fetchFn = vi.fn(async () => new Response('{}', { status: 200 }));
    running.push(await startDaemon(cfg, pino({ level: 'silent' }), fetchFn));

    expect(await send(cfg, { type: 'arm' })).toMatchObject({
      ok: false,
      error: { code: 'not_bound' },
    });
  });

  it('refuses to start on a broken journal and raises a critical alert', async () => {
    const cfg = config();
    const journal = Journal.open(cfg.stateDir);
    journal.append('system', 'daemon_started', {});
    journal.unsafeExecForTests('DROP TRIGGER journal_no_update');
    journal.unsafeExecForTests(`UPDATE journal SET actor = 'forged'`);
    journal.close();
    const fetchFn = vi.fn(async () => new Response('{}', { status: 200 }));

    await expect(startDaemon(cfg, pino({ level: 'silent' }), fetchFn)).rejects.toBeInstanceOf(
      JournalCorruptError,
    );
    const bodies = fetchFn.mock.calls.map((call) => String((call as unknown as [string, RequestInit])[1].body));
    expect(bodies.some((b) => b.includes('journal_corrupt'))).toBe(true);
  });
});
