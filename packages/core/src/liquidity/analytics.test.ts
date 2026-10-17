import { describe, expect, it } from 'vitest';
import { costToFill, depthCurve, depthWithin, referencePrice } from './analytics.js';
import type { BookLevel, OrderBookSnapshot } from './types.js';

const lv = (price: number, amount: number): BookLevel => ({ price, amount, outrightAmount: amount });

function book(overrides: Partial<OrderBookSnapshot> = {}): OrderBookSnapshot {
  return {
    venue: 'thalex',
    instrument: 'BTC-23OCT26-84000-C',
    priceUnit: 'usd',
    quantityUnit: 'base',
    bids: [lv(265, 1), lv(260, 1)],
    asks: [lv(320, 1), lv(330, 1)],
    totalBidAmount: 2,
    totalAskAmount: 2,
    exchangeTs: 1,
    receivedAt: 1,
    generation: 1,
    state: 'synced',
    crossed: false,
    mark: {
      markPrice: 290.61,
      indexPrice: 81144.65,
      delta: 0.18,
      iv: 0.3,
      collarLow: 217.96,
      collarHigh: 363.27,
      receivedAt: 1,
    },
    ...overrides,
  };
}

describe('costToFill', () => {
  it('walks asks for a buy and reports VWAP and slippage', () => {
    const fill = costToFill(book(), 'buy', 1.5);
    expect(fill.filled).toBe(1.5);
    expect(fill.fullyFilled).toBe(true);
    expect(fill.vwap).toBeCloseTo((320 + 0.5 * 330) / 1.5, 9);
    expect(fill.worstPrice).toBe(330);
    expect(fill.levelsUsed).toBe(2);
    expect(fill.notional).toBeCloseTo(485, 9);
    expect(fill.slippageVsTouch).toBeCloseTo(fill.vwap! - 320, 9);
    expect(fill.slippageVsMark).toBeCloseTo(fill.vwap! - 290.61, 9);
  });

  it('walks bids for a sell with slippage positive when worse', () => {
    const fill = costToFill(book(), 'sell', 2);
    expect(fill.vwap).toBe(262.5);
    expect(fill.slippageVsTouch).toBeCloseTo(2.5, 9);
    expect(fill.slippageVsMark).toBeCloseTo(290.61 - 262.5, 9);
    expect(fill.slippageVsMarkPct).toBeCloseTo(((290.61 - 262.5) / 290.61) * 100, 9);
  });

  it('reports a partial fill when the book runs out', () => {
    const fill = costToFill(book(), 'buy', 5);
    expect(fill.filled).toBe(2);
    expect(fill.fullyFilled).toBe(false);
  });

  it('handles an empty side and a missing mark', () => {
    const fill = costToFill(book({ asks: [], mark: null }), 'buy', 1);
    expect(fill).toMatchObject({ filled: 0, vwap: null, worstPrice: null, slippageVsMark: null });
    expect(costToFill(book({ mark: null }), 'buy', 1).slippageVsMark).toBeNull();
  });

  it('skips zero and invalid levels', () => {
    const fill = costToFill(book({ asks: [lv(320, 0), lv(Number.NaN, 1), lv(330, 1)] }), 'buy', 1);
    expect(fill.vwap).toBe(330);
  });
});

describe('depth', () => {
  it('sums size within each band around the mark', () => {
    const perp = book({
      bids: [lv(100, 1), lv(99.6, 2), lv(98, 3)],
      asks: [lv(100.2, 1), lv(100.9, 2), lv(103, 4)],
      mark: { ...book().mark!, markPrice: 100.1 },
    });
    const [half, one, five] = depthWithin(perp, [0.5, 1, 5]);
    expect(half).toMatchObject({ bidAmount: 3, askAmount: 1 });
    expect(one).toMatchObject({ bidAmount: 3, askAmount: 3 });
    expect(five).toMatchObject({ bidAmount: 6, askAmount: 7 });
    expect(five!.askNotional).toBeCloseTo(100.2 + 2 * 100.9 + 4 * 103, 9);
  });

  it('falls back to the mid when there is no mark, and to empty bands with no reference', () => {
    expect(referencePrice(book({ mark: null }))).toBe((265 + 320) / 2);
    const empty = book({ mark: null, bids: [] });
    expect(referencePrice(empty)).toBeNull();
    expect(depthWithin(empty, [1])[0]).toMatchObject({ bidAmount: 0, askAmount: 0 });
  });

  it('builds a cumulative curve for the taken side', () => {
    expect(depthCurve(book(), 'buy')).toEqual([
      { price: 320, cumulativeAmount: 1, cumulativeNotional: 320 },
      { price: 330, cumulativeAmount: 2, cumulativeNotional: 650 },
    ]);
  });
});
