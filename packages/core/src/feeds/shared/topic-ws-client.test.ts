import { describe, expect, it, vi } from 'vitest';
import { TopicWsClient } from './topic-ws-client.js';

type TopicWsClientInternals = {
  reconnectAttempts: number;
  scheduleReconnect: () => void;
  connect: () => Promise<void>;
  replayQueue: Array<string | Record<string, unknown>>;
  replaySubscriptions: () => Array<string | Record<string, unknown>>;
  flushReplayQueue: (messages: Array<string | Record<string, unknown>>) => void;
  ws: {
    readyState?: number;
    send?: (payload: string) => void;
    close: () => void;
    removeAllListeners: () => void;
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

  it('detaches socket listeners before closing on disconnect', async () => {
    const client = new TopicWsClient('ws://localhost:1234', 'test');
    const internals = client as unknown as TopicWsClientInternals;
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

  it('queues outbound messages until the socket opens', () => {
    const client = new TopicWsClient('ws://localhost:1234', 'test', {
      getReplayMessages: () => [{ op: 'subscribe', topic: 'btc' }],
    });
    const internals = client as unknown as TopicWsClientInternals;
    const send = vi.fn();

    internals.ws = {
      readyState: 0,
      send,
      close: vi.fn(),
      removeAllListeners: vi.fn(),
    };

    client.send({ op: 'subscribe', topic: 'btc' });
    expect(internals.replayQueue).toHaveLength(1);

    internals.ws = {
      readyState: 1,
      send,
      close: vi.fn(),
      removeAllListeners: vi.fn(),
    };

    const replayed = internals.replaySubscriptions();
    internals.flushReplayQueue(replayed);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(JSON.stringify({ op: 'subscribe', topic: 'btc' }));
    expect(internals.replayQueue).toHaveLength(0);
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
