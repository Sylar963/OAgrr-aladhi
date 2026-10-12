import { TradfiSectorsResponseSchema } from '@oggregator/protocol';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { TradfiStore } from '../runtime/store.js';
import type { TradfiInstrument } from '../tastytrade/instrument.js';
import { SECTOR_BASKETS, sectorSymbols } from './baskets.js';
import { buildSectorBoard } from './board.js';

// 2026-10-09 (Fri) as days since epoch.
const FRI = Date.UTC(2026, 9, 9) / 86_400_000;

function price(store: TradfiStore, symbol: string, prevClose: number, last: number) {
  store.mergeSession(symbol, { prevClose, prevDayId: FRI, lastTrade: last, ts: 1_000 });
}

const baskets = [
  { id: 'up', name: 'Up', symbols: ['A', 'B', 'C', 'D'] },
  { id: 'down', name: 'Down', symbols: ['E', 'F'] },
  { id: 'dark', name: 'Dark', symbols: ['Z'] },
];

describe('buildSectorBoard', () => {
  it('ranks baskets by mean move with breadth, median and members sorted best first', () => {
    const store = new TradfiStore();
    price(store, 'A', 100, 102);
    price(store, 'B', 100, 101);
    price(store, 'C', 100, 99);
    store.mergeSession('D', { prevClose: 50, ts: 900 });
    price(store, 'E', 10, 9.5);
    price(store, 'F', 10, 9.9);
    store.setInstruments([{ underlying: 'A' } as TradfiInstrument]);

    const board = buildSectorBoard({ store, tape: [{ symbol: 'A', label: 'Alpha' }], baskets });

    expect(board.baskets.map((b) => [b.id, b.rank])).toEqual([['up', 1], ['down', 2], ['dark', null]]);
    const up = board.baskets[0]!;
    expect(up.mean).toBeCloseTo(0.02 / 3);
    expect(up.median).toBeCloseTo(0.01);
    expect(up.green).toBe(2);
    expect(up.priced).toBe(3);
    expect(up.members.map((m) => m.symbol)).toEqual(['A', 'B', 'C', 'D']);
    expect(up.members[0]!.hasOptions).toBe(true);
    expect(up.members[1]!.hasOptions).toBe(false);
    expect(up.members[3]!.change).toBeNull();
    expect(board.baskets[1]!.median).toBeCloseTo(-0.03);
    expect(board.tape[0]).toMatchObject({ symbol: 'A', label: 'Alpha', last: 102 });
    expect(board.prevCloseDate).toBe('2026-10-09');
    expect(board.asOf).toBe(1_000);
  });

  it('falls back to spot when no trade has printed', () => {
    const store = new TradfiStore();
    store.mergeSession('Z', { prevClose: 20, ts: 5 });
    store.setSpot('Z', 21);
    const board = buildSectorBoard({ store, tape: [], baskets });
    expect(board.baskets[0]!.id).toBe('dark');
    expect(board.baskets[0]!.mean).toBeCloseTo(0.05);
  });

  it('defines unique basket ids and no duplicate members within a basket', () => {
    expect(new Set(SECTOR_BASKETS.map((b) => b.id)).size).toBe(SECTOR_BASKETS.length);
    for (const b of SECTOR_BASKETS) expect(new Set(b.symbols).size).toBe(b.symbols.length);
    expect(sectorSymbols()).toContain('IONQ');
  });
});

describe('GET /sectors', () => {
  it('serves a schema-valid board', async () => {
    const store = new TradfiStore();
    price(store, 'NVDA', 180, 185);
    const app = buildApp({
      store,
      feed: {
        readiness: () => ({
          catalogLoaded: true, quoteTokenAcquired: true, streaming: true,
          lastDataTs: 0, underlyings: 0, instruments: 0,
        }),
        ensureChainSubscribed: () => {},
        refreshChainQuotes: async () => 0,
      },
    });
    const res = await app.inject({ method: 'GET', url: '/sectors' });
    expect(res.statusCode).toBe(200);
    const body = TradfiSectorsResponseSchema.parse(res.json());
    const mag7 = body.baskets.find((b) => b.id === 'mag7')!;
    expect(mag7.rank).toBe(1);
    expect(mag7.members[0]!.symbol).toBe('NVDA');
    await app.close();
  });
});
