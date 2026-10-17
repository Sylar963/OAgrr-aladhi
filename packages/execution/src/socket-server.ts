import { chmodSync, existsSync, lstatSync, unlinkSync } from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import {
  type ExecutionEnvelope,
  ExecutionEnvelopeSchema,
  type ExecutionErrorCode,
  type ExecutionResponse,
} from '@oggregator/protocol';
import type { Logger } from 'pino';
import { ControlError, type LiveControl } from './control.js';
import type { Journal } from './journal.js';
import { verifyEnvelope } from './signing.js';

const MAX_LINE_BYTES = 64 * 1024;
const DEFAULT_MAX_SKEW_MS = 30_000;

export interface CommandServerOptions {
  control: Pick<LiveControl, 'execute'>;
  journal: Journal;
  hmacKey: Buffer;
  log: Logger;
  now?: () => number;
  maxSkewMs?: number;
}

function failure(code: ExecutionErrorCode, message: string): ExecutionResponse {
  return { ok: false, error: { code, message } };
}

/**
 * Newline-delimited JSON over a Unix socket. Every line must carry a valid HMAC, a timestamp
 * within the skew window, and a nonce not seen inside that window (replay protection that still
 * tolerates requests arriving out of order on separate connections).
 */
export class CommandServer {
  private readonly seenNonces = new Map<number, number>();
  private server: Server | null = null;
  private readonly now: () => number;
  private readonly maxSkewMs: number;

  constructor(private readonly options: CommandServerOptions) {
    this.now = options.now ?? Date.now;
    this.maxSkewMs = options.maxSkewMs ?? DEFAULT_MAX_SKEW_MS;
  }

  async handleLine(line: string): Promise<ExecutionResponse> {
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      return failure('invalid_request', 'Malformed JSON');
    }
    const parsed = ExecutionEnvelopeSchema.safeParse(raw);
    if (!parsed.success) return failure('invalid_request', 'Invalid command envelope');
    const envelope = parsed.data;

    if (!verifyEnvelope(envelope, this.options.hmacKey)) {
      this.reject('unverified', envelope, 'unauthenticated');
      return failure('unauthenticated', 'Bad signature');
    }
    const now = this.now();
    if (Math.abs(now - envelope.ts) > this.maxSkewMs) {
      this.reject(envelope.actor.clerkUserId, envelope, 'stale_request');
      return failure('stale_request', 'Request timestamp outside the allowed window');
    }
    this.pruneNonces(now);
    if (this.seenNonces.has(envelope.nonce)) {
      this.reject(envelope.actor.clerkUserId, envelope, 'replayed_nonce');
      return failure('replayed_nonce', 'Nonce already used');
    }
    this.seenNonces.set(envelope.nonce, envelope.ts);

    const isQuery = envelope.command.type === 'status';
    if (!isQuery) {
      const stored = this.options.journal.getIdempotentResponse(
        envelope.actor.accountId,
        envelope.idempotencyKey,
      );
      if (stored !== null) return JSON.parse(stored) as ExecutionResponse;
    }

    let response: ExecutionResponse;
    try {
      const status = await this.options.control.execute(envelope.actor, envelope.command);
      response = { ok: true, status };
    } catch (error) {
      if (!(error instanceof ControlError)) {
        this.options.log.error({ err: error, command: envelope.command.type }, 'command failed');
        return failure('internal', 'Command failed');
      }
      response = failure(error.code, error.message);
    }
    if (!isQuery) {
      this.options.journal.saveIdempotentResponse(
        envelope.actor.accountId,
        envelope.idempotencyKey,
        JSON.stringify(response),
      );
    }
    return response;
  }

  listen(socketPath: string): Promise<void> {
    if (existsSync(socketPath)) {
      if (!lstatSync(socketPath).isSocket()) {
        throw new Error(`${socketPath} exists and is not a socket`);
      }
      unlinkSync(socketPath);
    }
    const server = createServer((socket) => this.serve(socket));
    this.server = server;
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, () => {
        server.off('error', reject);
        // Group-writable so the API user (a member of the daemon's client group) can connect.
        chmodSync(socketPath, 0o660);
        resolve();
      });
    });
  }

  close(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (!server) return Promise.resolve();
    return new Promise((resolve) => server.close(() => resolve()));
  }

  private serve(socket: Socket): void {
    let buffer = '';
    let queue = Promise.resolve();
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      if (Buffer.byteLength(buffer) > MAX_LINE_BYTES && !buffer.includes('\n')) {
        socket.destroy();
        return;
      }
      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        queue = queue.then(async () => {
          const response = await this.handleLine(line);
          if (!socket.destroyed) socket.write(`${JSON.stringify(response)}\n`);
        });
        newline = buffer.indexOf('\n');
      }
    });
    socket.on('error', (err) => this.options.log.warn({ err }, 'command socket error'));
  }

  private reject(actor: string, envelope: ExecutionEnvelope, code: ExecutionErrorCode): void {
    if (envelope.command.type === 'status') return;
    this.options.journal.append(actor, 'command_rejected', {
      code,
      command: envelope.command.type,
      idempotencyKey: envelope.idempotencyKey,
    });
  }

  private pruneNonces(now: number): void {
    for (const [nonce, ts] of this.seenNonces) {
      if (now - ts > this.maxSkewMs * 2) this.seenNonces.delete(nonce);
    }
  }
}
