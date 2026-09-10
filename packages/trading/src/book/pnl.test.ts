import { describe, expect, it } from 'vitest';
import type { Fill } from './fill.js';
import { aggregateFillEconomics, computePositionPnl, computeSnapshot } from './pnl.js';
import type { Position } from './position.js';

const BASE_KEY: Position['key'] = {
  accountId: 'acc',
  underlying: 'BTC',
  expiry: '2026-06-26',
  strike: 70000,
  optionRight: 'call',
};

function makePos(netQuantity: number, avg: number, realized = 0): Position {
  return {
    key: BASE_KEY,
    netQuantity,
    avgEntryPriceUsd: avg,
    avgEntryIv: null,
    realizedPnlUsd: realized,
    openedAt: new Date('2026-04-17T00:00:00Z'),
    lastFillAt: new Date('2026-04-17T00:00:00Z'),
  };
}

function makeFill(side: Fill['side'], priceUsd: number, feesUsd: number): Fill {
  return {
    id: `${side}-${priceUsd}`,
    orderId: 'ord',
    legIndex: 0,
    venue: 'deribit',
    side,
    optionRight: 'call',
    underlying: 'BTC',
    expiry: '2026-06-26',
    strike: 70_000,
    quantity: 1,
    requestedQuantity: 1,
    priceUsd,
    iv: null,
    feesUsd,
    slippageUsd: 0,
    partialFill: false,
    benchmarkBidUsd: null,
    benchmarkAskUsd: null,
    benchmarkMidUsd: null,
    underlyingSpotUsd: null,
    source: 'paper',
    filledAt: new Date('2026-04-17T00:00:00Z'),
  };
}

describe('computePositionPnl', () => {
  it('returns null unrealized when mark is null', () => {
    const pnl = computePositionPnl(makePos(2, 1000), null);
    expect(pnl.unrealizedUsd).toBeNull();
    expect(pnl.markPriceUsd).toBeNull();
  });

  it('returns positive unrealized when mark is above entry for a long', () => {
    const pnl = computePositionPnl(makePos(2, 1000), 1500);
    expect(pnl.unrealizedUsd).toBe(1000);
  });

  it('returns negative unrealized when mark is below entry for a long', () => {
    const pnl = computePositionPnl(makePos(2, 1000), 800);
    expect(pnl.unrealizedUsd).toBe(-400);
  });

  it('inverts sign for shorts', () => {
    const pnl = computePositionPnl(makePos(-2, 1000), 800);
    expect(pnl.unrealizedUsd).toBe(400);
  });
});

describe('computeSnapshot', () => {
  it('aggregates signed premium cash flow and fees by instrument', () => {
    const economics = aggregateFillEconomics([
      makeFill('buy', 100, 5),
      makeFill('sell', 120, 3),
    ]);

    expect(economics).toEqual([
      {
        underlying: 'BTC',
        expiry: '2026-06-26',
        strike: 70_000,
        optionRight: 'call',
        premiumCashFlowUsd: 20,
        feesUsd: 8,
      },
    ]);
  });

  it('reports an opening fee as net realized and total PnL at an unchanged long mark', () => {
    const snap = computeSnapshot(
      [makePos(1, 100)],
      new Map([['BTC|2026-06-26|70000|call', 100]]),
      895,
      new Date('2026-04-17'),
      [
        {
          underlying: 'BTC',
          expiry: '2026-06-26',
          strike: 70_000,
          optionRight: 'call',
          premiumCashFlowUsd: -100,
          feesUsd: 5,
        },
      ],
    );

    expect(snap.positions[0]).toMatchObject({
      realizedUsd: -5,
      unrealizedUsd: 0,
      feesUsd: 5,
      totalUsd: -5,
    });
    expect(snap).toMatchObject({
      realizedUsd: -5,
      unrealizedUsd: 0,
      feesUsd: 5,
      totalUsd: -5,
      equityUsd: 995,
    });
  });

  it('reports an opening fee at an unchanged short mark without changing equity twice', () => {
    const snap = computeSnapshot(
      [makePos(-1, 100)],
      new Map([['BTC|2026-06-26|70000|call', 100]]),
      1095,
      new Date('2026-04-17'),
      [
        {
          underlying: 'BTC',
          expiry: '2026-06-26',
          strike: 70_000,
          optionRight: 'call',
          premiumCashFlowUsd: 100,
          feesUsd: 5,
        },
      ],
    );

    expect(snap).toMatchObject({ realizedUsd: -5, totalUsd: -5, equityUsd: 995 });
  });

  it('reconstructs net realized PnL for a partial close', () => {
    const snap = computeSnapshot(
      [makePos(1, 100, 20)],
      new Map([['BTC|2026-06-26|70000|call', 120]]),
      912,
      new Date('2026-04-17'),
      [
        {
          underlying: 'BTC',
          expiry: '2026-06-26',
          strike: 70_000,
          optionRight: 'call',
          premiumCashFlowUsd: -80,
          feesUsd: 8,
        },
      ],
    );

    expect(snap.positions[0]).toMatchObject({ realizedUsd: 12, unrealizedUsd: 20, totalUsd: 32 });
    expect(snap).toMatchObject({
      realizedUsd: 12,
      unrealizedUsd: 20,
      feesUsd: 8,
      totalUsd: 32,
      equityUsd: 1032,
    });
  });

  it('preserves lifetime realized PnL after a flat instrument is reopened', () => {
    const snap = computeSnapshot(
      [makePos(1, 90, 0)],
      new Map([['BTC|2026-06-26|70000|call', 90]]),
      924,
      new Date('2026-04-17'),
      [
        {
          underlying: 'BTC',
          expiry: '2026-06-26',
          strike: 70_000,
          optionRight: 'call',
          premiumCashFlowUsd: -70,
          feesUsd: 6,
        },
      ],
    );

    expect(snap.positions[0]).toMatchObject({ realizedUsd: 14, feesUsd: 6, totalUsd: 14 });
    expect(snap.equityUsd).toBe(1014);
  });

  it('adds signed marked inventory to cash without adding realized PnL again', () => {
    const longPos = makePos(2, 1000, 50);
    const shortPos = { ...makePos(-1, 500), key: { ...BASE_KEY, strike: 80000 } };
    const marks = new Map<string, number | null>([
      ['BTC|2026-06-26|70000|call', 1200],
      ['BTC|2026-06-26|80000|call', 400],
    ]);
    const snap = computeSnapshot([longPos, shortPos], marks, 100_000, new Date());
    expect(snap.realizedUsd).toBe(50);
    expect(snap.unrealizedUsd).toBe(400 + 100);
    expect(snap.equityUsd).toBe(100_000 + 2 * 1200 - 400);
  });

  it.each([
    { quantity: 1, cash: 895, mark: 100, equity: 995 },
    { quantity: -1, cash: 1095, mark: 100, equity: 995 },
    { quantity: 1, cash: 895, mark: 120, equity: 1015 },
    { quantity: -1, cash: 1095, mark: 120, equity: 975 },
    { quantity: 1, cash: 895, mark: 0, equity: 895 },
    { quantity: -1, cash: 1095, mark: 0, equity: 1095 },
  ])('values quantity $quantity at mark $mark after premium and fees', ({
    quantity,
    cash,
    mark,
    equity,
  }) => {
    const marks = new Map([['BTC|2026-06-26|70000|call', mark]]);
    const snap = computeSnapshot([makePos(quantity, 100)], marks, cash, new Date('2026-04-17'));
    expect(snap.equityUsd).toBe(equity);
  });

  it.each([1, -1])('reconciles partial and full closes for direction %s', (direction) => {
    const initialCash = 1000;
    const openingCash = initialCash - direction * 2 * 100 - 5;
    const partialCash = openingCash + direction * 120 - 3;
    const realized = direction * 20;
    const marks = new Map([['BTC|2026-06-26|70000|call', 120]]);
    const partial = computeSnapshot(
      [makePos(direction, 100, realized)],
      marks,
      partialCash,
      new Date('2026-04-17'),
    );
    expect(partial.equityUsd).toBe(initialCash + direction * 40 - 8);

    const closedCash = partialCash + direction * 120 - 3;
    const closed = computeSnapshot(
      [makePos(0, 0, realized * 2)],
      new Map(),
      closedCash,
      new Date('2026-04-17'),
    );
    expect(closed.equityUsd).toBe(initialCash + direction * 40 - 11);
  });

  it.each([
    1, -1,
  ])('preserves null row PnL and omits unpriced inventory for direction %s', (direction) => {
    for (const marks of [
      new Map<string, number | null>(),
      new Map([['BTC|2026-06-26|70000|call', null]]),
    ]) {
      const snap = computeSnapshot([makePos(direction, 100)], marks, 1000, new Date('2026-04-17'));
      expect(snap.equityUsd).toBe(1000);
      expect(snap.positions[0]?.markPriceUsd).toBeNull();
      expect(snap.positions[0]?.unrealizedUsd).toBeNull();
    }
  });

  it('returns cash as equity for an empty account', () => {
    const snap = computeSnapshot([], new Map(), 1000, new Date('2026-04-17'));
    expect(snap.equityUsd).toBe(1000);
  });
});
