import { generateKeyPairSync } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OrderBookSnapshot } from '../../liquidity/types.js';
import { type BookSocket, type BookSocketOptions, ThalexBookFeed } from './book-feed.js';

class FakeSocket implements BookSocket {
  connected = false;
  sent: Array<Record<string, unknown>> = [];
  constructor(readonly options: BookSocketOptions) {}
  get isConnected() {
    return this.connected;
  }
  async connect() {
    this.open();
  }
  async disconnect() {
    this.connected = false;
  }
  send(payload: Record<string, unknown>) {
    this.sent.push(payload);
  }
  open() {
    this.connected = true;
    for (const message of this.options.getReplayMessages()) this.send(message);
    this.options.onStatusChange('connected');
  }
  drop() {
    this.connected = false;
    this.options.onStatusChange('reconnecting');
  }
  push(frame: unknown) {
    this.options.onMessage(JSON.stringify(frame));
  }
  lastSubscribe() {
    return [...this.sent].reverse().find((m) => m['method'] === 'public/subscribe')!;
  }
}

function setup() {
  const books: OrderBookSnapshot[] = [];
  const rejected: string[] = [];
  let socket!: FakeSocket;
  const feed = new ThalexBookFeed(
    { onBook: (b) => books.push(b), onRejected: (i) => rejected.push(i) },
    {
      depth: 10,
      flushIntervalMs: 60_000,
      now: () => 1_000,
      createSocket: (options) => {
        socket = new FakeSocket(options);
        return socket;
      },
    },
  );
  return { feed, books, rejected, socket: () => socket };
}

const PERP = 'BTC-PERPETUAL';
const bookChannel = `book.${PERP}.none.10.100ms`;
const snapshotFrame = {
  channel_name: bookChannel,
  snapshot: true,
  notification: { bid_changes: [[100, 1, 1]], ask_changes: [[101, 2, 2]], time: 1792279976.1 },
};

afterEach(() => vi.useRealTimers());

describe('ThalexBookFeed', () => {
  it('connects on first add and subscribes the book and ticker channels', () => {
    const { feed, socket } = setup();
    feed.add(PERP);
    expect(socket().lastSubscribe()['params']).toEqual({
      channels: [bookChannel, `ticker.${PERP}.1000ms`],
    });
  });

  it('pushes a coalesced book per instrument on flush', () => {
    const { feed, books, socket } = setup();
    feed.add(PERP);
    socket().push(snapshotFrame);
    socket().push({
      channel_name: bookChannel,
      notification: { bid_changes: [[100, 0, 0], [99, 3, 3]] },
    });
    socket().push({
      channel_name: `ticker.${PERP}.1000ms`,
      notification: { mark_price: 100.5, mark_timestamp: 1, index: 100.4 },
    });
    feed.flush();

    expect(books).toHaveLength(1);
    expect(books[0]).toMatchObject({
      instrument: PERP,
      state: 'synced',
      bids: [{ price: 99, amount: 3 }],
      mark: { markPrice: 100.5, indexPrice: 100.4 },
    });
    feed.flush();
    expect(books).toHaveLength(1);
  });

  it('drops every book to unsynchronized on disconnect and resubscribes on reconnect', () => {
    const { feed, books, socket } = setup();
    feed.add(PERP);
    socket().push(snapshotFrame);
    feed.flush();

    socket().drop();
    feed.flush();
    expect(books.at(-1)).toMatchObject({ state: 'unsynchronized', bids: [], generation: 2 });

    socket().sent = [];
    socket().open();
    expect(socket().lastSubscribe()['params']).toEqual({
      channels: [bookChannel, `ticker.${PERP}.1000ms`],
    });
    socket().push(snapshotFrame);
    feed.flush();
    expect(books.at(-1)).toMatchObject({ state: 'synced', generation: 2 });
  });

  it('reports instruments Thalex silently left out of the subscribe ack', () => {
    const { feed, rejected, socket } = setup();
    feed.add('BTC-01JAN20-1000-C');
    const id = socket().lastSubscribe()['id'];
    socket().push({ id, result: ['ticker.BTC-01JAN20-1000-C.1000ms'] });
    expect(rejected).toEqual(['BTC-01JAN20-1000-C']);
  });

  it('resubscribes the book after an invalid frame', () => {
    const { feed, socket } = setup();
    feed.add(PERP);
    socket().push(snapshotFrame);
    socket().sent = [];
    socket().push({ channel_name: bookChannel, notification: { ask_changes: [[101, -5, 0]] } });
    expect(socket().sent.map((m) => m['method'])).toEqual(['unsubscribe', 'public/subscribe']);
  });

  it('unsubscribes on remove and disconnects when nothing is left', () => {
    const { feed, socket } = setup();
    feed.add(PERP);
    feed.remove(PERP);
    expect(socket().sent.at(-1)).toMatchObject({
      method: 'unsubscribe',
      params: { channels: [bookChannel, `ticker.${PERP}.1000ms`] },
    });
    expect(socket().isConnected).toBe(false);
    expect(feed.instruments()).toEqual([]);
  });

  it('flushes on its interval', () => {
    vi.useFakeTimers();
    const books: OrderBookSnapshot[] = [];
    let socket!: FakeSocket;
    const feed = new ThalexBookFeed(
      { onBook: (b) => books.push(b) },
      { createSocket: (o) => (socket = new FakeSocket(o)) },
    );
    feed.add(PERP);
    socket.push({ ...snapshotFrame, channel_name: `book.${PERP}.none.25.100ms` });
    vi.advanceTimersByTime(100);
    expect(books).toHaveLength(1);
    void feed.stop();
  });
});

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const AUTH = {
  kid: 'kid-1',
  privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
};

describe('ThalexBookFeed login', () => {
  it('logs in on connect and subscribes only once the login is answered', () => {
    const { feed, socket } = setup();
    feed.setAuth(AUTH);
    feed.add(PERP);
    feed.add('BTC-25DEC26');

    const login = socket().sent[0]!;
    expect(login['method']).toBe('public/login');
    expect(socket().sent).toHaveLength(1);

    socket().push({ id: login['id'], result: { account_number: 'A1' } });
    expect(socket().lastSubscribe()['params']).toEqual({
      channels: [bookChannel, `ticker.${PERP}.1000ms`, 'book.BTC-25DEC26.none.10.100ms', 'ticker.BTC-25DEC26.1000ms'],
    });
  });

  it('still subscribes when the login is refused', () => {
    const { feed, socket } = setup();
    feed.setAuth(AUTH);
    feed.add(PERP);
    const login = socket().sent[0]!;
    socket().push({ id: login['id'], error: { code: 1, message: 'bad token' } });
    expect(socket().lastSubscribe()).toBeDefined();
  });

  it('reconnects with the new login when the key changes', async () => {
    const { feed, socket } = setup();
    feed.add(PERP);
    socket().sent = [];
    feed.setAuth(AUTH);
    await new Promise((r) => setTimeout(r, 0));
    expect(socket().sent[0]?.['method']).toBe('public/login');
  });
});
