import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  instrumentFromBookChannel,
  instrumentFromTickerChannel,
  isThalexBookInstrument,
  ThalexBookState,
  thalexBookChannel,
} from './book.js';
import { ThalexBookNotificationSchema, ThalexTickerNotificationSchema } from './types.js';

type Frame = { channel_name?: string; snapshot?: boolean; notification?: unknown };
const capture = JSON.parse(
  readFileSync(new URL('./__fixtures__/book-frames.json', import.meta.url), 'utf8'),
) as { frames: Frame[] };
const frames = capture.frames;

function bookFrames(prefix: string) {
  return frames
    .filter((f) => f.channel_name?.startsWith(prefix))
    .map((f) => ThalexBookNotificationSchema.parse(f));
}

describe('Thalex book channel helpers', () => {
  it('accepts outrights and 2-4 leg combos only', () => {
    expect(isThalexBookInstrument('BTC-PERPETUAL')).toBe(true);
    expect(isThalexBookInstrument('ETH-25DEC26')).toBe(true);
    expect(isThalexBookInstrument('BTC-23OCT26-84000-C')).toBe(true);
    expect(isThalexBookInstrument('[BTC-23OCT26-84000-C:-1,BTC-23OCT26-84000-P:1]')).toBe(true);
    expect(isThalexBookInstrument('[BTC-23OCT26-84000-C:-1]')).toBe(false);
    expect(isThalexBookInstrument('SOL-PERPETUAL')).toBe(false);
    expect(isThalexBookInstrument('BTC-PERPETUAL.none.all.raw')).toBe(false);
    expect(isThalexBookInstrument('')).toBe(false);
  });

  it('round-trips instrument names through channel names', () => {
    const combo = '[BTC-23OCT26-84000-C:-1,BTC-23OCT26-84000-P:1]';
    expect(instrumentFromBookChannel(thalexBookChannel(combo, 10))).toBe(combo);
    expect(instrumentFromBookChannel('book.BTC-PERPETUAL.none.10.100ms')).toBe('BTC-PERPETUAL');
    expect(instrumentFromTickerChannel('ticker.BTC-PERPETUAL.1000ms')).toBe('BTC-PERPETUAL');
    expect(instrumentFromBookChannel('ticker.BTC-PERPETUAL.1000ms')).toBeNull();
  });
});

describe('ThalexBookState with the live capture', () => {
  it('builds the perp book from its snapshot and keeps it at depth through deltas', () => {
    const state = new ThalexBookState('BTC-PERPETUAL', 10);
    const [snapshot, ...deltas] = bookFrames('book.BTC-PERPETUAL');
    expect(snapshot!.snapshot).toBe(true);

    expect(state.apply(snapshot!.notification, true, 1, 1)).toBe('applied');
    const first = state.toSnapshot();
    expect(first.state).toBe('synced');
    expect(first.bids[0]).toEqual({ price: 81170, amount: 0.0009, outrightAmount: 0.0009 });
    expect(first.asks[0]!.price).toBe(81178);
    expect(first.bids).toHaveLength(10);
    expect(first.exchangeTs).toBeGreaterThan(1_700_000_000_000);

    for (const delta of deltas) state.apply(delta.notification, false, 2, 1);
    const after = state.toSnapshot();
    expect(after.bids.length).toBeLessThanOrEqual(10);
    expect(after.asks.length).toBeLessThanOrEqual(10);
    expect(after.bids.every((l, i, a) => i === 0 || a[i - 1]!.price > l.price)).toBe(true);
    expect(after.asks.every((l, i, a) => i === 0 || a[i - 1]!.price < l.price)).toBe(true);
    expect(after.bids.every((l) => l.amount > 0)).toBe(true);
    expect(after.crossed).toBe(false);
  });

  it('keeps implied combo liquidity and drops the zero combo timestamp', () => {
    const state = new ThalexBookState('[BTC-23OCT26-84000-C:-1,BTC-23OCT26-84000-P:1]', 10);
    const [snapshot] = bookFrames('book.[');
    state.apply(snapshot!.notification, true, 1, 1);
    const book = state.toSnapshot();
    expect(book.bids[0]).toEqual({ price: 2645, amount: 1, outrightAmount: 0 });
    expect(book.exchangeTs).toBeNull();
  });

  it('merges the ticker mark into the book', () => {
    const state = new ThalexBookState('BTC-23OCT26-84000-C', 10);
    const ticker = ThalexTickerNotificationSchema.parse(
      frames.find((f) => f.channel_name?.startsWith('ticker.BTC-23OCT26-84000-C')),
    );
    state.applyTicker(ticker.notification, 5);
    expect(state.toSnapshot().mark).toMatchObject({ markPrice: 290.61, delta: expect.any(Number) });
  });
});

describe('ThalexBookState sync rules', () => {
  const snapshot = { bid_changes: [[100, 1, 1]], ask_changes: [[101, 2, 2]], time: 1 };

  it('ignores deltas until a snapshot arrives', () => {
    const state = new ThalexBookState('BTC-PERPETUAL');
    expect(state.apply({ bid_changes: [[100, 1, 1]] }, false, 1, 1)).toBe('ignored');
    expect(state.syncState).toBe('uninitialized');
  });

  it('applies deletes and updates after the snapshot', () => {
    const state = new ThalexBookState('BTC-PERPETUAL');
    state.apply(snapshot, true, 1, 1);
    state.apply({ bid_changes: [[100, 0, 0], [99, 3, 2]] }, false, 2, 1);
    expect(state.toSnapshot().bids).toEqual([{ price: 99, amount: 3, outrightAmount: 2 }]);
  });

  it('goes unsynchronized on an invalid level and clears levels', () => {
    const state = new ThalexBookState('BTC-PERPETUAL');
    state.apply(snapshot, true, 1, 1);
    expect(state.apply({ ask_changes: [[101, -1, 0]] }, false, 2, 1)).toBe('invalid');
    const book = state.toSnapshot();
    expect(book.state).toBe('unsynchronized');
    expect(book.asks).toEqual([]);
    expect(state.apply({ bid_changes: [[100, 1, 1]] }, false, 3, 1)).toBe('ignored');
  });

  it('recovers on the next snapshot with the new generation', () => {
    const state = new ThalexBookState('BTC-PERPETUAL');
    state.apply(snapshot, true, 1, 1);
    state.markUnsynchronized(2);
    expect(state.toSnapshot()).toMatchObject({ state: 'unsynchronized', generation: 2, bids: [] });
    state.apply(snapshot, true, 3, 2);
    expect(state.toSnapshot()).toMatchObject({ state: 'synced', generation: 2 });
  });

  it('flags a crossed book without resyncing', () => {
    const state = new ThalexBookState('BTC-PERPETUAL');
    state.apply({ bid_changes: [[102, 1, 0]], ask_changes: [[101, 1, 1]] }, true, 1, 1);
    expect(state.toSnapshot()).toMatchObject({ state: 'synced', crossed: true });
  });
});
