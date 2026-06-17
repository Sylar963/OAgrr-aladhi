import { describe, it, expect, vi } from 'vitest';
import { CandleClient } from './candle-client.js';
import type { CandleSocket } from './candle-client.js';

function fakeSocket() {
  let onMsg: (m: unknown) => void = () => {};
  let onOpen: () => void = () => {};
  let open = false;
  const sent: unknown[] = [];
  const sock: CandleSocket = {
    // Model the real ws: sending before the socket is open throws.
    send: (m) => { if (!open) throw new Error('WebSocket is not open'); sent.push(m); },
    onOpen: (cb) => { onOpen = cb; },
    onMessage: (cb) => { onMsg = cb; },
    onClose: () => {},
    close: () => {},
  };
  return { sock, sent, emit: (m: unknown) => onMsg(m), emitOpen: () => { open = true; onOpen(); } };
}

describe('CandleClient', () => {
  it('handshakes and resolves a snapshot ending on SNAPSHOT_END', async () => {
    const fs = fakeSocket();
    const client = new CandleClient({
      getToken: async () => ({ token: 'T', dxlinkUrl: 'wss://x' }),
      socketFactory: () => fs.sock,
      now: () => 1_700_000_000_000,
    });
    await client.connect();
    fs.emitOpen(); // socket opens -> SETUP is sent
    fs.emit({ type: 'AUTH_STATE', state: 'UNAUTHORIZED' });
    fs.emit({ type: 'AUTH_STATE', state: 'AUTHORIZED' });
    fs.emit({ type: 'CHANNEL_OPENED', channel: 1 });
    fs.emit({ type: 'FEED_CONFIG', channel: 1 });

    const p = client.getCandles('.SPXW260623C7555', '5m', 123);
    // server streams a snapshot: one real bar, then a terminal SNAPSHOT_END record
    fs.emit({ type: 'FEED_DATA', channel: 1, data: ['Candle', [
      'Candle', '.SPXW260623C7555{=5m}', 4, 1781553000000, 55.9, 56.1, 55.8, 56.0, 3,
    ]] });
    fs.emit({ type: 'FEED_DATA', channel: 1, data: ['Candle', [
      'Candle', '.SPXW260623C7555{=5m}', 0x0a, 1781553300000, 'NaN', 'NaN', 'NaN', 'NaN', 'NaN',
    ]] });
    const bars = await p;
    expect(bars).toHaveLength(1);
    expect(bars[0]).toMatchObject({ time: 1781553000000, o: 55.9, c: 56.0 });
    expect(fs.sent.some((m) => (m as { type?: string }).type === 'AUTH')).toBe(true);
    expect(fs.sent.some((m) => (m as { type?: string; add?: unknown }).type === 'FEED_SUBSCRIPTION' && (m as { add?: unknown }).add)).toBe(true);
  });

  it('resolves with collected bars on timeout when no terminal flag arrives', async () => {
    vi.useFakeTimers();
    const fs = fakeSocket();
    const client = new CandleClient({
      getToken: async () => ({ token: 'T', dxlinkUrl: 'wss://x' }),
      socketFactory: () => fs.sock, now: () => 1_700_000_000_000, requestTimeoutMs: 1000,
    });
    await client.connect();
    fs.emitOpen(); // socket opens -> SETUP is sent
    fs.emit({ type: 'FEED_CONFIG', channel: 1 });
    const p = client.getCandles('SPY', '5m', 1);
    fs.emit({ type: 'FEED_DATA', channel: 1, data: ['Candle', ['Candle', 'SPY{=5m}', 0, 1781553000000, 1, 1, 1, 1, 9]] });
    await vi.advanceTimersByTimeAsync(1000);
    expect((await p)).toHaveLength(1);
    vi.useRealTimers();
  });
});

describe('CandleClient live', () => {
  function ready() {
    const fs = fakeSocket();
    const client = new CandleClient({
      getToken: async () => ({ token: 'T', dxlinkUrl: 'wss://x' }),
      socketFactory: () => fs.sock,
      now: () => 1_700_000_000_000,
    });
    return { fs, client };
  }
  function adds(sent: unknown[]): unknown[] {
    return sent.filter((m) => (m as { type?: string; add?: unknown }).type === 'FEED_SUBSCRIPTION' && (m as { add?: unknown }).add);
  }
  function removes(sent: unknown[]): unknown[] {
    return sent.filter((m) => (m as { type?: string; remove?: unknown }).type === 'FEED_SUBSCRIPTION' && (m as { remove?: unknown }).remove);
  }

  it('subscribes and forwards finite live bars to the consumer', async () => {
    const { fs, client } = ready();
    await client.connect();
    fs.emitOpen();
    fs.emit({ type: 'FEED_CONFIG', channel: 1 });

    const seen: number[] = [];
    client.subscribeLive('SPX', '5m', 1, (bar) => seen.push(bar.c));
    expect(adds(fs.sent)).toHaveLength(1);

    fs.emit({ type: 'FEED_DATA', channel: 1, data: ['Candle', ['Candle', 'SPX{=5m}', 0, 1781553000000, 1, 2, 0, 1.5, 9]] });
    // a terminal SNAPSHOT_END (NaN) bar must NOT tear the live subscription down
    fs.emit({ type: 'FEED_DATA', channel: 1, data: ['Candle', ['Candle', 'SPX{=5m}', 0x0a, 1781553300000, 'NaN', 'NaN', 'NaN', 'NaN', 'NaN']] });

    expect(seen).toEqual([1.5]);
    expect(removes(fs.sent)).toHaveLength(0);
  });

  it('ref-counts: one add for two consumers, removes only after the last leaves', async () => {
    const { fs, client } = ready();
    await client.connect();
    fs.emitOpen();
    fs.emit({ type: 'FEED_CONFIG', channel: 1 });

    const a: number[] = [];
    const b: number[] = [];
    const offA = client.subscribeLive('SPX', '5m', 1, (bar) => a.push(bar.c));
    const offB = client.subscribeLive('SPX', '5m', 1, (bar) => b.push(bar.c));
    expect(adds(fs.sent)).toHaveLength(1); // second consumer rides the same wire sub

    offA();
    expect(removes(fs.sent)).toHaveLength(0);

    fs.emit({ type: 'FEED_DATA', channel: 1, data: ['Candle', ['Candle', 'SPX{=5m}', 0, 1781553000000, 1, 1, 1, 2, 1]] });
    expect(a).toEqual([]); // A unsubscribed
    expect(b).toEqual([2]);

    offB();
    expect(removes(fs.sent)).toHaveLength(1);
  });

  it('does not unsubscribe while a one-shot is still pending for the same symbol, and vice-versa', async () => {
    const { fs, client } = ready();
    await client.connect();
    fs.emitOpen();
    fs.emit({ type: 'FEED_CONFIG', channel: 1 });

    const off = client.subscribeLive('SPX', '5m', 1, () => {});
    const p = client.getCandles('SPX', '5m', 1); // one-shot for the same symbol

    // one-shot completes -> must NOT remove (live still present)
    fs.emit({ type: 'FEED_DATA', channel: 1, data: ['Candle', ['Candle', 'SPX{=5m}', 0x08, 1781553000000, 1, 1, 1, 1, 1]] });
    await p;
    expect(removes(fs.sent)).toHaveLength(0);

    // now drop the live consumer -> remove fires (nothing left)
    off();
    expect(removes(fs.sent)).toHaveLength(1);
  });

  it('queues the subscribe until the feed is ready', async () => {
    const { fs, client } = ready();
    await client.connect();
    fs.emitOpen(); // open but NOT ready (no FEED_CONFIG)

    client.subscribeLive('SPX', '5m', 1, () => {});
    expect(adds(fs.sent)).toHaveLength(0);

    fs.emit({ type: 'FEED_CONFIG', channel: 1 });
    expect(adds(fs.sent)).toHaveLength(1);
  });

  it('dispose clears live consumers', async () => {
    const { fs, client } = ready();
    await client.connect();
    fs.emitOpen();
    fs.emit({ type: 'FEED_CONFIG', channel: 1 });

    const seen: number[] = [];
    client.subscribeLive('SPX', '5m', 1, (bar) => seen.push(bar.c));
    client.dispose();
    fs.emit({ type: 'FEED_DATA', channel: 1, data: ['Candle', ['Candle', 'SPX{=5m}', 0, 1781553000000, 1, 1, 1, 9, 1]] });
    expect(seen).toEqual([]);
  });
});
