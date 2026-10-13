import { afterEach, describe, expect, it, vi } from 'vitest';

const { FakeWebSocket } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { EventEmitter } = require('node:events') as typeof import('node:events');
  class FakeWebSocket extends EventEmitter {
    static CONNECTING = 0;
    static OPEN = 1;
    static instances: FakeWebSocket[] = [];
    readyState = FakeWebSocket.CONNECTING;
    terminate = vi.fn();
    close = vi.fn();
    send = vi.fn();
    constructor(public url: string) {
      super();
      FakeWebSocket.instances.push(this);
    }
    open(): void {
      this.readyState = FakeWebSocket.OPEN;
      this.emit('open');
    }
    drop(): void {
      this.readyState = 3;
      this.emit('close', 1006, Buffer.alloc(0));
    }
  }
  return { FakeWebSocket };
});

vi.mock('ws', () => ({
  default: FakeWebSocket,
}));

import { TopicWsClient } from './topic-ws-client.js';

type TopicWsClientInternals = {
  reconnectAttempts: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  scheduleReconnect: () => void;
  connect: () => Promise<void>;
  ws: {
    close: () => void;
    removeAllListeners: () => void;
    on: (event: string, listener: () => void) => void;
  } | null;
};

describe('TopicWsClient', () => {
  it('keeps retrying after the max reconnect attempt budget is exceeded', () => {
    vi.useFakeTimers();

    const client = new TopicWsClient('ws://localhost:1234', 'test', {
      maxReconnectAttempts: 1,
    });
    const internals = client as unknown as TopicWsClientInternals;
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

    const client = new TopicWsClient('ws://localhost:1234', 'test', {
      maxReconnectAttempts: 0,
    });
    const internals = client as unknown as TopicWsClientInternals;
    const connect = vi.fn(async () => {});

    internals.connect = connect;
    internals.scheduleReconnect();
    internals.scheduleReconnect();

    vi.advanceTimersByTime(60_000);

    expect(connect).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('schedules another reconnect when a reconnect attempt rejects before opening', async () => {
    vi.useFakeTimers();

    const client = new TopicWsClient('ws://localhost:1234', 'test', {
      reconnectDelayMs: 1_000,
    });
    const internals = client as unknown as TopicWsClientInternals;
    const connect = vi.fn(async () => {
      throw new Error('connect failed');
    });

    internals.connect = connect;
    internals.scheduleReconnect();

    await vi.advanceTimersByTimeAsync(1_300);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(internals.reconnectTimer).not.toBeNull();

    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('detaches socket listeners before closing on disconnect', async () => {
    const client = new TopicWsClient('ws://localhost:1234', 'test');
    const internals = client as unknown as TopicWsClientInternals;
    const socket = {
      close: vi.fn(),
      removeAllListeners: vi.fn(),
      on: vi.fn(),
    };

    internals.ws = socket;
    await client.disconnect();

    expect(socket.removeAllListeners).toHaveBeenCalledOnce();
    expect(socket.close).toHaveBeenCalledOnce();
    expect(internals.ws).toBeNull();
  });

  it('survives the error ws emits when a still-connecting socket is closed on disconnect', async () => {
    FakeWebSocket.instances = [];
    const client = new TopicWsClient('ws://localhost:1234', 'test');
    client.connect().catch(() => {});
    const socket = FakeWebSocket.instances.at(-1)!;

    await client.disconnect();

    expect(() =>
      socket.emit('error', new Error('WebSocket was closed before the connection was established')),
    ).not.toThrow();
  });

  it('resolves a fresh URL on each connect when constructed with a factory', () => {
    let counter = 0;
    const client = new TopicWsClient(() => `wss://signed/?ts=${counter++}`, 'test');
    const internals = client as unknown as { resolveUrl: () => string };

    expect(internals.resolveUrl()).toBe('wss://signed/?ts=0');
    expect(internals.resolveUrl()).toBe('wss://signed/?ts=1');
  });

  it('returns the same static URL on each connect when constructed with a string', () => {
    const client = new TopicWsClient('ws://localhost:1234', 'test');
    const internals = client as unknown as { resolveUrl: () => string };

    expect(internals.resolveUrl()).toBe('ws://localhost:1234');
    expect(internals.resolveUrl()).toBe('ws://localhost:1234');
  });
});

describe('TopicWsClient lifecycle', () => {
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('terminates a socket whose upgrade never completes and schedules a retry', async () => {
    vi.useFakeTimers();
    FakeWebSocket.instances = [];
    const client = new TopicWsClient('ws://localhost:1234', 'test', { handshakeTimeoutMs: 1_000 });
    const internals = client as unknown as TopicWsClientInternals;
    const connected = client.connect();
    const failed = expect(connected).rejects.toThrow();
    const socket = FakeWebSocket.instances.at(-1)!;
    socket.terminate.mockImplementation(() => {
      socket.emit('error', new Error('WebSocket was closed before the connection was established'));
      socket.drop();
    });

    await vi.advanceTimersByTimeAsync(1_000);

    expect(socket.terminate).toHaveBeenCalledOnce();
    await failed;
    expect(internals.reconnectTimer).not.toBeNull();
  });

  it('keeps escalating backoff for sessions that drop right after opening', async () => {
    vi.useFakeTimers();
    FakeWebSocket.instances = [];
    const client = new TopicWsClient('ws://localhost:1234', 'test', { stableSessionMs: 60_000 });
    const internals = client as unknown as TopicWsClientInternals;

    client.connect().catch(() => {});
    FakeWebSocket.instances.at(-1)!.open();
    FakeWebSocket.instances.at(-1)!.drop();
    expect(internals.reconnectAttempts).toBe(1);

    await vi.advanceTimersByTimeAsync(1_300);
    FakeWebSocket.instances.at(-1)!.open();
    FakeWebSocket.instances.at(-1)!.drop();

    expect(internals.reconnectAttempts).toBe(2);
  });

  it('resets the backoff once a session stays up for the stable window', async () => {
    vi.useFakeTimers();
    FakeWebSocket.instances = [];
    const client = new TopicWsClient('ws://localhost:1234', 'test', { stableSessionMs: 60_000 });
    const internals = client as unknown as TopicWsClientInternals;
    internals.reconnectAttempts = 5;

    client.connect().catch(() => {});
    FakeWebSocket.instances.at(-1)!.open();
    expect(internals.reconnectAttempts).toBe(5);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(internals.reconnectAttempts).toBe(0);
  });

  it('terminates an open socket that goes silent past the idle timeout', async () => {
    vi.useFakeTimers();
    FakeWebSocket.instances = [];
    const client = new TopicWsClient('ws://localhost:1234', 'test', { idleTimeoutMs: 30_000 });

    client.connect().catch(() => {});
    const socket = FakeWebSocket.instances.at(-1)!;
    socket.open();

    await vi.advanceTimersByTimeAsync(20_000);
    socket.emit('pong');
    await vi.advanceTimersByTimeAsync(20_000);
    expect(socket.terminate).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(10_000);
    expect(socket.terminate).toHaveBeenCalledOnce();
  });
});
