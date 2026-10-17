import { createHmac, randomUUID } from 'node:crypto';
import { connect } from 'node:net';
import {
  canonicalJson,
  type ExecutionCommand,
  type ExecutionResponse,
  ExecutionResponseSchema,
  type LiveActor,
  type UnsignedExecutionEnvelope,
} from '@oggregator/protocol';

const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_RESPONSE_BYTES = 64 * 1024;

export type ExecutionResult = ExecutionResponse | { unavailable: true; reason: string };

export interface ExecutionClientOptions {
  socketPath: string;
  hmacKey: Buffer;
  timeoutMs?: number;
  now?: () => number;
}

function decodeKey(raw: string): Buffer {
  const trimmed = raw.trim();
  return /^[a-fA-F0-9]{64}$/.test(trimmed)
    ? Buffer.from(trimmed, 'hex')
    : Buffer.from(trimmed, 'base64');
}

/**
 * Talks to the execution daemon over its Unix socket. The daemon holds the trading keys and
 * enforces limits itself; this side only proves the request came from the API (HMAC) and says
 * which verified user is asking.
 */
export class ExecutionClient {
  private lastNonce = 0;
  private readonly now: () => number;

  constructor(private readonly options: ExecutionClientOptions) {
    if (options.hmacKey.length < 32) throw new Error('EXECUTION_SOCKET_HMAC_KEY must be 32 bytes');
    this.now = options.now ?? Date.now;
  }

  static fromEnv(env: NodeJS.ProcessEnv): ExecutionClient | null {
    const socketPath = env['EXECUTION_SOCKET_PATH']?.trim();
    const rawKey = env['EXECUTION_SOCKET_HMAC_KEY'];
    if (!socketPath || !rawKey) return null;
    return new ExecutionClient({ socketPath, hmacKey: decodeKey(rawKey) });
  }

  send(
    actor: LiveActor,
    command: ExecutionCommand,
    idempotencyKey: string = randomUUID(),
  ): Promise<ExecutionResult> {
    const ts = this.now();
    // Microsecond-scaled so nonces keep increasing across API restarts.
    this.lastNonce = Math.max(ts * 1000, this.lastNonce + 1);
    const unsigned: UnsignedExecutionEnvelope = {
      command,
      actor,
      idempotencyKey,
      nonce: this.lastNonce,
      ts,
    };
    const hmac = createHmac('sha256', this.options.hmacKey)
      .update(canonicalJson(unsigned))
      .digest('hex');
    return this.roundTrip(`${JSON.stringify({ ...unsigned, hmac })}\n`);
  }

  private roundTrip(line: string): Promise<ExecutionResult> {
    return new Promise((resolve) => {
      let settled = false;
      let buffer = '';
      const finish = (result: ExecutionResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        resolve(result);
      };
      const socket = connect(this.options.socketPath, () => socket.write(line));
      const timer = setTimeout(
        () => finish({ unavailable: true, reason: 'timeout' }),
        this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      );
      socket.setEncoding('utf8');
      socket.on('data', (chunk: string) => {
        buffer += chunk;
        if (buffer.length > MAX_RESPONSE_BYTES) {
          finish({ unavailable: true, reason: 'response_too_large' });
          return;
        }
        const newline = buffer.indexOf('\n');
        if (newline === -1) return;
        try {
          const parsed = ExecutionResponseSchema.safeParse(JSON.parse(buffer.slice(0, newline)));
          finish(parsed.success ? parsed.data : { unavailable: true, reason: 'invalid_response' });
        } catch {
          finish({ unavailable: true, reason: 'invalid_response' });
        }
      });
      socket.on('error', (err: NodeJS.ErrnoException) =>
        finish({ unavailable: true, reason: err.code ?? 'socket_error' }),
      );
      socket.on('close', () => finish({ unavailable: true, reason: 'closed' }));
    });
  }
}
