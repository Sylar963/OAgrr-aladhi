import type { VolHeatmapColumn, VolHeatmapMeta } from '@oggregator/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { price76 } from '../../feeds/thalex/bs-solver.js';
import { type HeatmapRpc, VolHeatmapFeed } from './feed.js';

const NOW = Date.UTC(2026, 9, 17, 12, 0, 3);
const NOV6 = Date.UTC(2026, 10, 6, 8);
const NOV27 = Date.UTC(2026, 10, 27, 8);

const instrument = (name: string, strike: number, option_type: 'call' | 'put', expiration_timestamp: number) => ({
  instrument_name: name,
  strike,
  option_type,
  expiration_timestamp,
  kind: 'option',
  is_active: true,
});

const INSTRUMENTS = [
  instrument('BTC-6NOV26-81000-C', 81_000, 'call', NOV6),
  instrument('BTC-6NOV26-81000-P', 81_000, 'put', NOV6),
  instrument('BTC-27NOV26-81000-C', 81_000, 'call', NOV27),
  instrument('BTC-27NOV26-81000-P', 81_000, 'put', NOV27),
  instrument('BTC-27NOV26-90000-C', 90_000, 'call', NOV27),
  instrument('BTC-27NOV26-90000-P', 90_000, 'put', NOV27),
];

class FakeRpc implements HeatmapRpc {
  handler: ((channel: string, data: unknown) => void) | null = null;
  subscribed: string[] = [];
  unsubscribed: string[] = [];
  instruments: unknown[] = INSTRUMENTS;

  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  onSubscription(handler: (channel: string, data: unknown) => void): void {
    this.handler = handler;
  }
  async subscribe(channels: string[]): Promise<void> {
    this.subscribed.push(...channels);
  }
  async unsubscribe(channels: string[]): Promise<void> {
    this.unsubscribed.push(...channels);
  }
  async call(method: string): Promise<unknown> {
    if (method === 'public/get_instruments') return this.instruments;
    if (method === 'public/get_index_price') return { index_price: 81_163.55, estimated_delivery_price: 81_163.55 };
    if (method === 'public/get_volatility_index_data') return { data: [[NOW - 60_000, 37, 38, 36, 37.44]], continuation: null };
    throw new Error(`unexpected ${method}`);
  }
  push(channel: string, data: unknown): void {
    this.handler?.(channel, data);
  }
}

let feed: VolHeatmapFeed | null = null;
afterEach(async () => {
  await feed?.stop();
  feed = null;
});

function setup() {
  const rpc = new FakeRpc();
  const columns: VolHeatmapColumn[] = [];
  const metas: VolHeatmapMeta[] = [];
  let now = NOW;
  feed = new VolHeatmapFeed(
    ['BTC'],
    { onColumn: (_c, column) => columns.push(column), onMeta: (_c, meta) => metas.push(meta) },
    { rpc, now: () => now, columnMs: 15_000 },
  );
  return { rpc, columns, metas, feed, setNow: (t: number) => (now = t) };
}

describe('VolHeatmapFeed', () => {
  it('subscribes DVOL, trades, the selected books and one forward ticker per expiry', async () => {
    const { rpc, metas, feed } = setup();
    await feed.start();

    expect(rpc.subscribed).toEqual(
      expect.arrayContaining([
        'deribit_volatility_index.btc_usd',
        'trades.option.BTC.100ms',
        'book.BTC-27NOV26-81000-C.none.10.agg2',
        'book.BTC-27NOV26-90000-C.none.10.agg2',
        'ticker.BTC-6NOV26-81000-C.agg2',
        'ticker.BTC-27NOV26-81000-C.agg2',
      ]),
    );
    // 90k is OTM on the call side only.
    expect(rpc.subscribed).not.toContain('book.BTC-27NOV26-90000-P.none.10.agg2');
    expect(metas[0]).toMatchObject({ expiries: ['2026-11-06', '2026-11-27'], instruments: 5 });
  });

  it('routes Deribit payloads into a column flushed at the column boundary', async () => {
    const { rpc, columns, feed, setNow } = setup();
    await feed.start();

    const forward = 81_702.44;
    const tYears = (NOV27 - NOW) / (365 * 86_400_000);
    const bid = price76(forward, 81_000, 0.36, tYears, 'call') / forward;

    rpc.push('ticker.BTC-27NOV26-81000-C.agg2', {
      instrument_name: 'BTC-27NOV26-81000-C',
      underlying_price: forward,
      mark_iv: 36.12,
      timestamp: NOW,
    });
    rpc.push('book.BTC-27NOV26-81000-C.none.10.agg2', {
      timestamp: NOW,
      change_id: 178_864_213_063,
      instrument_name: 'BTC-27NOV26-81000-C',
      bids: [[bid, 2.7]],
      asks: [],
    });
    rpc.push('deribit_volatility_index.btc_usd', { timestamp: NOW, index_name: 'btc_usd', volatility: 37.44 });
    rpc.push('trades.option.BTC.100ms', [
      {
        trade_seq: 1,
        trade_id: '1',
        timestamp: NOW,
        tick_direction: 0,
        price: 0.0525,
        mark_price: 0.0523,
        iv: 36.5,
        instrument_name: 'BTC-27NOV26-81000-C',
        index_price: 81_163.55,
        direction: 'buy',
        amount: 1.5,
      },
    ]);

    feed.tick();
    expect(columns).toHaveLength(0);
    setNow(Date.UTC(2026, 9, 17, 12, 0, 15));
    feed.tick();

    expect(columns).toHaveLength(1);
    const [column] = columns;
    expect(column!.t).toBe(Date.UTC(2026, 9, 17, 12, 0, 0));
    expect(column!.dvol).toBeCloseTo(0.3744, 6);
    expect(column!.cells).toHaveLength(1);
    expect(column!.cells[0]![0]).toBe(144);
    expect(column!.trades).toEqual([
      expect.objectContaining({ instrument: 'BTC-27NOV26-81000-C', side: 'buy', iv: 0.365, amount: 1.5 }),
    ]);
  });

  it('unsubscribes books that drop out on reselection', async () => {
    const { rpc, feed } = setup();
    await feed.start();
    rpc.instruments = INSTRUMENTS.filter((i) => i.instrument_name !== 'BTC-27NOV26-90000-C');
    await feed.reselect('BTC');
    expect(rpc.unsubscribed).toEqual(['book.BTC-27NOV26-90000-C.none.10.agg2']);
  });
});
