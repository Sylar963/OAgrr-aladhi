import { describe, expect, it, vi } from 'vitest';

const { FakeWebSocket } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { EventEmitter } = require('node:events') as typeof import('node:events');
  class FakeWebSocket extends EventEmitter {
    static OPEN = 1;
    static instances: FakeWebSocket[] = [];
    readyState = 0;
    terminate = vi.fn();
    close = vi.fn();
    ping = vi.fn();
    send = vi.fn();
    bufferedAmount = 0;
    constructor(public url: string) {
      super();
      FakeWebSocket.instances.push(this);
    }
  }
  return { FakeWebSocket };
});

vi.mock('ws', () => ({
  default: FakeWebSocket,
}));

import { JsonRpcWsClient } from './jsonrpc-client.js';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

type JsonRpcWsClientInternals = {
  call: (
    method: string,
    params?: Record<string, unknown>,
    timeoutOverrideMs?: number,
  ) => Promise<unknown>;
  resubscribe: () => Promise<void>;
  subscribedChannels: Set<string>;
  reconnectAttempts: number;
  shortSessionStreak: number;
  scheduleReconnect: () => void;
  connect: () => Promise<void>;
  startHeartbeat: () => void;
  cleanup: () => void;
  heartbeatTimer: ReturnType<typeof setInterval> | null;
  ws: {
    close: () => void;
    removeAllListeners: () => void;
  } | null;
};

describe('JsonRpcWsClient', () => {
  it('keeps intended subscriptions for replay when the connection drops mid-subscribe', async () => {
    const client = new JsonRpcWsClient('ws://localhost:1234', 'test');
    const internals = client as unknown as JsonRpcWsClientInternals;

    internals.call = vi.fn(async () => {
      throw new Error('[test] connection closed');
    });

    await expect(client.subscribe(['ticker.BTC-1.raw'])).rejects.toThrow('connection closed');
    expect([...internals.subscribedChannels]).toEqual(['ticker.BTC-1.raw']);
  });

  it('rolls back optimistic subscriptions on definite RPC failures', async () => {
    const client = new JsonRpcWsClient('ws://localhost:1234', 'test');
    const internals = client as unknown as JsonRpcWsClientInternals;

    internals.call = vi.fn(async () => {
      throw new Error('[test] RPC error 10000: invalid channel');
    });

    await expect(client.subscribe(['ticker.BTC-1.raw'])).rejects.toThrow('invalid channel');
    expect([...internals.subscribedChannels]).toEqual([]);
  });

  it('sends only newly added subscriptions to the RPC call', async () => {
    const client = new JsonRpcWsClient('ws://localhost:1234', 'test');
    const internals = client as unknown as JsonRpcWsClientInternals;

    internals.subscribedChannels = new Set(['ticker.BTC-1.raw']);
    internals.call = vi.fn(async () => undefined);

    await client.subscribe(['ticker.BTC-1.raw', 'ticker.BTC-2.raw']);

    expect(internals.call).toHaveBeenCalledOnce();
    expect(internals.call).toHaveBeenCalledWith('public/subscribe', {
      channels: ['ticker.BTC-2.raw'],
    });
  });

  it('skips the RPC call when every requested subscription is already active', async () => {
    const client = new JsonRpcWsClient('ws://localhost:1234', 'test');
    const internals = client as unknown as JsonRpcWsClientInternals;

    internals.subscribedChannels = new Set(['ticker.BTC-1.raw']);
    internals.call = vi.fn(async () => undefined);

    await client.subscribe(['ticker.BTC-1.raw']);

    expect(internals.call).not.toHaveBeenCalled();
  });

  it('keeps retrying after the max reconnect attempt budget is exceeded', () => {
    vi.useFakeTimers();

    const client = new JsonRpcWsClient('ws://localhost:1234', 'test', {
      maxReconnectAttempts: 1,
    });
    const internals = client as unknown as JsonRpcWsClientInternals;
    const connect = vi.fn(async () => {});

    internals.connect = connect;
    internals.reconnectAttempts = 1;
    internals.scheduleReconnect();

    vi.advanceTimersByTime(60_000);

    expect(connect).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('does not queue duplicate reconnect timers for the same outage', () => {
    vi.useFakeTimers();

    const client = new JsonRpcWsClient('ws://localhost:1234', 'test', {
      maxReconnectAttempts: 0,
    });
    const internals = client as unknown as JsonRpcWsClientInternals;
    const connect = vi.fn(async () => {});

    internals.connect = connect;
    internals.scheduleReconnect();
    internals.scheduleReconnect();

    vi.advanceTimersByTime(60_000);

    expect(connect).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('does not install a fallback ping timer after cleanup cancels heartbeat setup', async () => {
    vi.useFakeTimers();

    const heartbeatCall = deferred<unknown>();
    const client = new JsonRpcWsClient('ws://localhost:1234', 'test');
    const internals = client as unknown as JsonRpcWsClientInternals;

    internals.call = vi.fn(() => heartbeatCall.promise);
    internals.startHeartbeat();
    internals.cleanup();
    heartbeatCall.reject(new Error('connection closed'));
    await Promise.resolve();
    await Promise.resolve();

    expect(internals.heartbeatTimer).toBeNull();
    vi.useRealTimers();
  });

  it('rejects connect() and terminates the socket when the WS handshake hangs', async () => {
    vi.useFakeTimers();
    FakeWebSocket.instances = [];

    const client = new JsonRpcWsClient('ws://localhost:1234', 'test', {
      handshakeTimeoutMs: 100,
      maxReconnectAttempts: 0,
    });

    const connectPromise = client.connect();
    // Catch the rejection eagerly so the unhandled rejection doesn't fail the run
    // before we get to the assertion below.
    const assertion = expect(connectPromise).rejects.toThrow(/handshake/i);

    const socket = FakeWebSocket.instances.at(-1);
    expect(socket).toBeDefined();

    await vi.advanceTimersByTimeAsync(150);

    await assertion;
    expect(socket!.terminate).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('caps stacked rate-limit cooldowns at the configured ceiling', () => {
    vi.useFakeTimers();
    // Use a non-zero base time so the implementation's first-hit sentinel
    // (`rateLimitFirstHitAt === 0`) correctly anchors on the first call.
    const t0 = 1_000_000;
    vi.setSystemTime(t0);

    const client = new JsonRpcWsClient('wss://example/ws', 'test', {
      rateLimitCooldownMs: 60_000,
      maxCooldownTotalMs: 120_000,
    });
    const internals = client as unknown as {
      noteRateLimit: (error: unknown) => void;
      remainingRateLimitCooldownMs: () => number;
    };

    // t=0 (relative): first hit → cooldown until +60_000
    internals.noteRateLimit(new Error('over_limit'));
    expect(internals.remainingRateLimitCooldownMs()).toBe(60_000);

    // t=30_000: second hit → would extend to +90_000, still under ceiling
    vi.advanceTimersByTime(30_000);
    internals.noteRateLimit(new Error('over_limit'));
    expect(internals.remainingRateLimitCooldownMs()).toBe(60_000);

    // t=60_000: third hit → would extend to +120_000, at ceiling
    vi.advanceTimersByTime(30_000);
    internals.noteRateLimit(new Error('over_limit'));
    expect(internals.remainingRateLimitCooldownMs()).toBe(60_000);

    // t=70_000: fourth hit → would push to +130_000, must cap at +120_000
    vi.advanceTimersByTime(10_000);
    internals.noteRateLimit(new Error('over_limit'));
    expect(internals.remainingRateLimitCooldownMs()).toBeLessThanOrEqual(50_000);

    vi.useRealTimers();
  });

  it('does not reset reconnectAttempts on bare open — only after a successful subscribe RPC', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    FakeWebSocket.instances = [];

    const client = new JsonRpcWsClient('wss://example/ws', 'test', {
      reconnectDelayMs: 100,
      maxReconnectAttempts: 5,
      handshakeTimeoutMs: 10_000,
    });
    const internals = client as unknown as JsonRpcWsClientInternals;

    // First connect: open fires, no subscribe RPC happens.
    const p1 = client.connect();
    const socket1 = FakeWebSocket.instances.at(-1)!;
    socket1.readyState = FakeWebSocket.OPEN;
    socket1.emit('open');
    await p1;
    expect(internals.reconnectAttempts).toBe(0);

    // Drop the socket — close handler should schedule a reconnect and increment attempts.
    socket1.readyState = 3;
    socket1.emit('close', 1006, Buffer.from(''));
    expect(internals.reconnectAttempts).toBeGreaterThanOrEqual(1);
    const attemptsAfterFirstClose = internals.reconnectAttempts;

    // Let the reconnect timer fire (backoff base 100ms + ≤200ms jitter, so wait long
    // enough to cover the upper bound). Second open arrives without a subscribe RPC.
    await vi.advanceTimersByTimeAsync(500);
    const socket2 = FakeWebSocket.instances.at(-1)!;
    expect(socket2).not.toBe(socket1);
    socket2.readyState = FakeWebSocket.OPEN;
    socket2.emit('open');

    // With the bug: reconnectAttempts would be reset back to 0 by the 'open' handler.
    // With the fix: it stays at the value scheduleReconnect raised it to, because
    // subscribe() never roundtripped successfully.
    expect(internals.reconnectAttempts).toBeGreaterThanOrEqual(attemptsAfterFirstClose);

    vi.useRealTimers();
  });

  it('escalates the flap streak across repeated short-lived sessions and resets after a durable one', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    FakeWebSocket.instances = [];

    const client = new JsonRpcWsClient('wss://example/ws', 'test', {
      reconnectDelayMs: 100,
      maxReconnectAttempts: 20,
      handshakeTimeoutMs: 10_000,
      heartbeatIntervalSec: 30, // stable threshold = max(90s, 3×30s) = 90s
    });
    const internals = client as unknown as JsonRpcWsClientInternals;
    internals.call = vi.fn(async () => undefined);

    const openLatest = () => {
      const socket = FakeWebSocket.instances.at(-1)!;
      socket.readyState = FakeWebSocket.OPEN;
      socket.emit('open');
      return socket;
    };

    const p1 = client.connect();
    let socket = openLatest();
    await p1;
    expect(internals.shortSessionStreak).toBe(0);

    // Each session lives 5s (≪ 90s), drops, then the reconnect timer opens the next.
    for (let i = 1; i <= 3; i += 1) {
      vi.advanceTimersByTime(5_000);
      socket.readyState = 3;
      socket.emit('close', 1006, Buffer.from(''));
      expect(internals.shortSessionStreak).toBe(i);
      // Advance past the largest possible flap floor (cap 120s) so the timer fires.
      await vi.advanceTimersByTimeAsync(130_000);
      socket = openLatest();
    }

    // A session that survives past the stable threshold clears the streak.
    vi.advanceTimersByTime(95_000);
    socket.readyState = 3;
    socket.emit('close', 1006, Buffer.from(''));
    expect(internals.shortSessionStreak).toBe(0);

    vi.useRealTimers();
  });

  it('floors the reconnect delay with flap backoff when sessions keep dying young', () => {
    vi.useFakeTimers();

    const client = new JsonRpcWsClient('ws://localhost:1234', 'test', {
      reconnectDelayMs: 100, // base/backoff delay stays well under the flap floor
      maxReconnectAttempts: 20,
    });
    const internals = client as unknown as JsonRpcWsClientInternals;
    const connect = vi.fn(async () => {});
    internals.connect = connect;

    internals.reconnectAttempts = 0;
    // streak 3 with a 1-session tolerance → flapBackoffDelay(2) = 30_000ms floor.
    internals.shortSessionStreak = 3;
    internals.scheduleReconnect();

    // The tiny base delay would have fired already; the flap floor holds it back.
    vi.advanceTimersByTime(20_000);
    expect(connect).not.toHaveBeenCalled();

    vi.advanceTimersByTime(11_000); // now past 30_000
    expect(connect).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it('counts a socket that closes before ever opening as a flap', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    FakeWebSocket.instances = [];

    const client = new JsonRpcWsClient('wss://example/ws', 'test', {
      reconnectDelayMs: 100,
      maxReconnectAttempts: 20,
      handshakeTimeoutMs: 10_000,
    });
    const internals = client as unknown as JsonRpcWsClientInternals;
    internals.call = vi.fn(async () => undefined);

    // A durable session first, so connectedAt is non-zero before the never-opened drop.
    const p1 = client.connect();
    const socket1 = FakeWebSocket.instances.at(-1)!;
    socket1.readyState = FakeWebSocket.OPEN;
    socket1.emit('open');
    await p1;
    vi.advanceTimersByTime(95_000);
    socket1.readyState = 3;
    socket1.emit('close', 1006, Buffer.from(''));
    expect(internals.shortSessionStreak).toBe(0);

    // Reconnect creates socket2, but it never opens — closing it reports undefined
    // uptime (connectedAt was cleared on teardown) and must count as a flap.
    await vi.advanceTimersByTimeAsync(500);
    const socket2 = FakeWebSocket.instances.at(-1)!;
    expect(socket2).not.toBe(socket1);
    socket2.emit('close', 1006, Buffer.from(''));
    expect(internals.shortSessionStreak).toBe(1);

    vi.useRealTimers();
  });

  it('resets reconnectAttempts only after every resubscribe batch succeeds', async () => {
    const client = new JsonRpcWsClient('ws://localhost:1234', 'test', {
      resubscribeBatchSize: 1,
    });
    const internals = client as unknown as JsonRpcWsClientInternals;

    internals.reconnectAttempts = 4;
    internals.subscribedChannels = new Set(['a', 'b', 'c']);
    internals.call = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('[test] public/subscribe timed out after 30000ms'));

    await expect(internals.resubscribe()).rejects.toThrow('timed out');

    expect(internals.reconnectAttempts).toBe(4);

    internals.call = vi.fn(async () => undefined);

    await internals.resubscribe();

    expect(internals.reconnectAttempts).toBe(0);
  });

  it('retries timed-out resubscribe batches with smaller batches', async () => {
    const client = new JsonRpcWsClient('ws://localhost:1234', 'test', {
      resubscribeBatchSize: 4,
      resubscribeBatchTimeoutMs: 30_000,
    });
    const internals = client as unknown as JsonRpcWsClientInternals;
    const requestedBatchSizes: number[] = [];

    internals.subscribedChannels = new Set(['a', 'b', 'c', 'd']);
    internals.call = vi.fn(async (_method, params) => {
      const channels = params?.channels;
      if (!Array.isArray(channels)) throw new Error('missing channels');
      requestedBatchSizes.push(channels.length);
      if (channels.length === 4) {
        throw new Error('[test] public/subscribe timed out after 30000ms');
      }
      return undefined;
    });

    await internals.resubscribe();

    expect(requestedBatchSizes).toEqual([4, 2, 2]);
    expect(internals.call).toHaveBeenCalledWith(
      'public/subscribe',
      { channels: ['a', 'b', 'c', 'd'] },
      30_000,
    );
  });

  it('exposes reconnectAttempts and rateLimitUntil via public getters', () => {
    const client = new JsonRpcWsClient('ws://localhost:1234', 'test');

    expect(client.reconnectAttemptsCount).toBe(0);
    expect(client.rateLimitUntilMs).toBe(0);

    (client as unknown as { noteRateLimit: (e: unknown) => void }).noteRateLimit(
      new Error('over_limit'),
    );

    expect(client.rateLimitUntilMs).toBeGreaterThan(0);
  });

  it('detaches socket listeners before closing on disconnect', async () => {
    const client = new JsonRpcWsClient('ws://localhost:1234', 'test');
    const internals = client as unknown as JsonRpcWsClientInternals;
    const socket = {
      close: vi.fn(),
      removeAllListeners: vi.fn(),
    };

    internals.ws = socket;
    await client.disconnect();

    expect(socket.removeAllListeners).toHaveBeenCalledOnce();
    expect(socket.close).toHaveBeenCalledOnce();
    expect(internals.ws).toBeNull();
  });
});
