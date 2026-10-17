import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExecutionCommand, ExecutionResponse, LiveStatus } from '@oggregator/protocol';
import pino from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ControlError } from './control.js';
import { Journal } from './journal.js';
import { signEnvelope } from './signing.js';
import { CommandServer } from './socket-server.js';

const key = Buffer.alloc(32, 5);
const actor = { clerkUserId: 'user_1', accountId: 'acct_1' };
const NOW = 1_760_000_000_000;
const status: LiveStatus = {
  state: 'killed',
  killedReason: 'manual',
  keyBound: true,
  venue: { name: 'stub', connected: false },
  alerts: { telegramConfigured: true, emailConfigured: true, testDelivered: true },
  journal: { lastSeq: 1, chainOk: true },
};

let nonce = 0;
function line(
  command: ExecutionCommand,
  overrides: { ts?: number; nonce?: number; idempotencyKey?: string; signWith?: Buffer } = {},
): string {
  nonce += 1;
  const envelope = signEnvelope(
    {
      command,
      actor,
      idempotencyKey: overrides.idempotencyKey ?? randomUUID(),
      nonce: overrides.nonce ?? nonce,
      ts: overrides.ts ?? NOW,
    },
    overrides.signWith ?? key,
  );
  return JSON.stringify(envelope);
}

function setup(execute = vi.fn(async () => status)) {
  const journal = Journal.memory();
  const server = new CommandServer({
    control: { execute },
    journal,
    hmacKey: key,
    log: pino({ level: 'silent' }),
    now: () => NOW,
  });
  return { server, journal, execute };
}

const kill: ExecutionCommand = { type: 'kill', scope: { kind: 'global' }, reason: 'manual' };

describe('CommandServer.handleLine', () => {
  it('executes a correctly signed command', async () => {
    const { server, execute } = setup();
    const response = await server.handleLine(line(kill));
    expect(response).toEqual({ ok: true, status });
    expect(execute).toHaveBeenCalledWith(actor, kill);
  });

  it('rejects a bad signature and journals the attempt', async () => {
    const { server, journal, execute } = setup();
    const response = await server.handleLine(line(kill, { signWith: Buffer.alloc(32, 6) }));
    expect(response).toMatchObject({ ok: false, error: { code: 'unauthenticated' } });
    expect(execute).not.toHaveBeenCalled();
    expect(journal.lastOfType(['command_rejected'])?.payload).toMatchObject({
      code: 'unauthenticated',
    });
  });

  it('rejects a tampered command even with a valid-looking hmac', async () => {
    const { server, execute } = setup();
    const envelope = JSON.parse(line(kill));
    envelope.actor.accountId = 'acct_other';
    const response = await server.handleLine(JSON.stringify(envelope));
    expect(response).toMatchObject({ ok: false, error: { code: 'unauthenticated' } });
    expect(execute).not.toHaveBeenCalled();
  });

  it('rejects stale timestamps and replayed nonces', async () => {
    const { server } = setup();
    expect(await server.handleLine(line(kill, { ts: NOW - 31_000 }))).toMatchObject({
      error: { code: 'stale_request' },
    });
    await server.handleLine(line(kill, { nonce: 999 }));
    expect(await server.handleLine(line(kill, { nonce: 999 }))).toMatchObject({
      error: { code: 'replayed_nonce' },
    });
  });

  it('accepts nonces arriving out of order', async () => {
    const { server } = setup();
    expect((await server.handleLine(line(kill, { nonce: 5_002 }))).ok).toBe(true);
    expect((await server.handleLine(line(kill, { nonce: 5_001 }))).ok).toBe(true);
  });

  it('returns the stored result for a repeated idempotency key without re-executing', async () => {
    const { server, execute } = setup();
    const idempotencyKey = randomUUID();
    const first = await server.handleLine(line(kill, { idempotencyKey }));
    const second = await server.handleLine(line(kill, { idempotencyKey }));
    expect(second).toEqual(first);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('maps control errors and stores them for idempotent replay', async () => {
    const execute = vi.fn(async () => {
      throw new ControlError('not_bound', 'No key');
    });
    const { server } = setup(execute);
    const idempotencyKey = randomUUID();
    const response = await server.handleLine(line({ type: 'arm' }, { idempotencyKey }));
    expect(response).toEqual({ ok: false, error: { code: 'not_bound', message: 'No key' } });
    await server.handleLine(line({ type: 'arm' }, { idempotencyKey }));
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('does not store status queries', async () => {
    const { server, execute } = setup();
    const idempotencyKey = randomUUID();
    await server.handleLine(line({ type: 'status' }, { idempotencyKey }));
    await server.handleLine(line({ type: 'status' }, { idempotencyKey }));
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('rejects malformed input', async () => {
    const { server } = setup();
    expect(await server.handleLine('not json')).toMatchObject({ error: { code: 'invalid_request' } });
    expect(await server.handleLine('{"command":{"type":"withdraw"}}')).toMatchObject({
      error: { code: 'invalid_request' },
    });
  });
});

describe('CommandServer socket', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('serves line-delimited commands on a group-writable socket', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ogg-sock-'));
    dirs.push(dir);
    const path = join(dir, 'exec.sock');
    const { server } = setup();
    await server.listen(path);
    expect(statSync(path).mode & 0o777).toBe(0o660);

    const response = await new Promise<ExecutionResponse>((resolve, reject) => {
      const socket = connect(path, () => socket.write(`${line(kill)}\n`));
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

    expect(response.ok).toBe(true);
    await server.close();
  });
});
