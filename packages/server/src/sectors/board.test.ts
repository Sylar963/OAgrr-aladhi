import type { PerpTicker } from '@oggregator/core';
import { describe, expect, it } from 'vitest';
import { memberDef, SECTOR_BASKETS, SECTOR_TAPE } from './baskets.js';
import { buildSectorBoard } from './board.js';

function snapshot(entries: Record<string, [number, number]>) {
  const tickers = new Map<string, PerpTicker>(
    Object.entries(entries).map(([symbol, [lastPrice, change24hPct]]) => [
      symbol,
      { symbol, lastPrice, change24hPct },
    ]),
  );
  return { fetchedAt: 42, tickers };
}

const venueUnderlyings = [
  { venue: 'deribit', underlyings: ['BTC', 'BTC_USDC', 'ETH'] },
  { venue: 'paradex', underlyings: ['BTC', 'US500'] },
];

describe('buildSectorBoard', () => {
  it('ranks baskets by mean 24h move with breadth, median, scaled prices and option venues', () => {
    const board = buildSectorBoard({
      snapshot: snapshot({
        BTCUSDT: [70_000, 0.02],
        ETHUSDT: [2_500, -0.01],
        '1000PEPEUSDT': [0.004, 0.05],
        SPYUSDT: [650, 0.001],
      }),
      venueUnderlyings,
      tape: [{ symbol: 'US500', label: 'US500 (SPY)', bybit: 'SPYUSDT' }],
      baskets: [
        { id: 'majors', name: 'Majors', members: ['ETH', 'BTC', 'DARK'] },
        {
          id: 'memes',
          name: 'Memes',
          members: [{ symbol: 'PEPE', bybit: '1000PEPEUSDT', scale: 1000 }],
        },
        { id: 'empty', name: 'Empty', members: ['NOPE'] },
      ],
    });

    expect(board.baskets.map((b) => [b.id, b.rank])).toEqual([
      ['memes', 1],
      ['majors', 2],
      ['empty', null],
    ]);
    const majors = board.baskets[1]!;
    expect(majors.mean).toBeCloseTo(0.005);
    expect(majors.median).toBeCloseTo(0.005);
    expect([majors.green, majors.priced]).toEqual([1, 2]);
    expect(majors.members.map((m) => m.symbol)).toEqual(['BTC', 'ETH', 'DARK']);
    expect(majors.members[0]!.optionVenues).toEqual(['deribit', 'paradex']);
    expect(majors.members[1]!.optionVenues).toEqual(['deribit']);
    expect(majors.members[2]).toMatchObject({ last: null, change: null, optionVenues: [] });
    expect(board.baskets[0]!.members[0]!.last).toBeCloseTo(0.000004);
    expect(board.tape[0]).toMatchObject({
      symbol: 'US500',
      label: 'US500 (SPY)',
      last: 650,
      optionVenues: ['paradex'],
    });
    expect(board.venueCount).toBe(2);
    expect(board.asOf).toBe(42);
  });

  it('defines unique basket ids, unique members per basket, and an RWA basket', () => {
    expect(new Set(SECTOR_BASKETS.map((b) => b.id)).size).toBe(SECTOR_BASKETS.length);
    for (const b of SECTOR_BASKETS) {
      const symbols = b.members.map((m) => memberDef(m).symbol);
      expect(new Set(symbols).size).toBe(symbols.length);
    }
    const rwa = SECTOR_BASKETS.find((b) => b.id === 'rwa')!;
    expect(rwa.members.map((m) => memberDef(m).bybit)).toEqual(
      expect.arrayContaining(['XAUUSDT', 'XAGUSDT', 'CLUSDT', 'SPYUSDT', 'QQQUSDT', 'MSTRUSDT']),
    );
    expect(SECTOR_TAPE.map((m) => memberDef(m).symbol)).toContain('BTC');
  });
});
