import { describe, it, expect, vi } from 'vitest';
import { CandleClient } from './candle-client.js';
import type { CandleSocket } from './candle-client.js';

function fakeSocket() {
  let onMsg: (m: unknown) => void = () => {};
  const sent: unknown[] = [];
  const sock: CandleSocket = {
    send: (m) => { sent.push(m); },
    onMessage: (cb) => { onMsg = cb; },
    onClose: () => {},
    close: () => {},
  };
  return { sock, sent, emit: (m: unknown) => onMsg(m) };
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
    fs.emit({ type: 'FEED_CONFIG', channel: 1 });
    const p = client.getCandles('SPY', '5m', 1);
    fs.emit({ type: 'FEED_DATA', channel: 1, data: ['Candle', ['Candle', 'SPY{=5m}', 0, 1781553000000, 1, 1, 1, 1, 9]] });
    await vi.advanceTimersByTimeAsync(1000);
    expect((await p)).toHaveLength(1);
    vi.useRealTimers();
  });
});
