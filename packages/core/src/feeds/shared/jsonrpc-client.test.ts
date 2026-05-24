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
  call: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  subscribedChannels: Set<string>;
  reconnectAttempts: number;
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
