import { describe, expect, it, vi } from 'vitest';
import { TopicWsClient } from './topic-ws-client.js';

type TopicWsClientInternals = {
  reconnectAttempts: number;
  scheduleReconnect: () => void;
  connect: () => Promise<void>;
  ws: {
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
});
