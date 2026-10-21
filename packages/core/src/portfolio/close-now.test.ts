import type { PositionLeg, StrategyGroup } from '@oggregator/protocol';
import { describe, expect, it } from 'vitest';

import { cappedTakerFeeUsd, THALEX_OPTION_FEE_RATE, VENUE_FEE_CAP } from '../core/fees.js';
import type { OrderBookSnapshot } from '../liquidity/types.js';
import { computeTotals } from './aggregator.js';
import {
  CLOSE_NOW_BOOK_SILENCE_MS,
  CLOSE_NOW_SPREAD_MIN_SAMPLES,
  CLOSE_NOW_SPREAD_SAMPLE_MS,
  CloseNowTracker,
  type ExitBookLookup,
  evaluateCloseNowLeg,
  exitVenueOf,
} from './close-now.js';
import type { MarkContext } from './types.js';

const NOW = Date.UTC(2026, 9, 21, 12);
const INDEX = 100_000;
const CAP = VENUE_FEE_CAP.thalex;

function makeLeg(overrides: Partial<PositionLeg> = {}): PositionLeg {
  return {
    legId: 'leg-1',
    underlying: 'BTC',
    expiry: '2026-11-27',
    strike: 110_000,
    optionRight: 'call',
    size: 1,
    entryPriceUsd: 1_000,
    entryIv: 0.5,
    entryTs: NOW,
    venueHint: 'thalex',
    source: 'thalex',
    realizedPnlUsd: 0,
    ...overrides,
  };
}

function makeMark(markPriceUsd: number | null): MarkContext {
  return {
    underlyingPriceUsd: INDEX,
    forwardPriceUsd: INDEX,
    markPriceUsd,
    iv: 0.5,
    delta: 0.3,
    gamma: 0.00001,
    vega: 100,
    theta: -20,
    yearsToExpiry: 0.1,
  };
}

function level(price: number, amount: number) {
  return { price, amount, outrightAmount: amount };
}

function makeBook(
  bids: Array<[number, number]>,
  asks: Array<[number, number]>,
  overrides: Partial<OrderBookSnapshot> = {},
): OrderBookSnapshot {
  return {
    venue: 'thalex',
    instrument: 'BTC-27NOV26-110000-C',
    priceUnit: 'usd',
    quantityUnit: 'base',
    bids: bids.map(([p, a]) => level(p, a)),
    asks: asks.map(([p, a]) => level(p, a)),
    totalBidAmount: null,
    totalAskAmount: null,
    exchangeTs: NOW,
    receivedAt: NOW,
    generation: 1,
    state: 'synced',
    crossed: false,
    mark: {
      markPrice: 1_500,
      indexPrice: INDEX,
      delta: 0.3,
      iv: 0.5,
      collarLow: 1_000,
      collarHigh: 2_000,
      receivedAt: NOW,
    },
    ...overrides,
  };
}

const fee = (price: number, size: number) =>
  cappedTakerFeeUsd(THALEX_OPTION_FEE_RATE, CAP, price, INDEX, size);

function evaluate(leg: PositionLeg, markUsd: number | null, book: OrderBookSnapshot) {
  return evaluateCloseNowLeg({ leg, mark: makeMark(markUsd) }, 'thalex', book.instrument, book, NOW);
}

describe('evaluateCloseNowLeg', () => {
  it('sells a long into a deep bid at the VWAP, after fees', () => {
    const leg = makeLeg({ size: 2 });
    const book = makeBook([[1_450, 1], [1_400, 5]], [[1_550, 5]]);

    const result = evaluate(leg, 1_500, book);

    const vwap = (1_450 + 1_400) / 2;
    expect(result.status).toBe('ok');
    expect(result.side).toBe('sell');
    expect(result.filledSize).toBe(2);
    expect(result.exitVwapUsd).toBeCloseTo(vwap);
    expect(result.feesUsd).toBeCloseTo(fee(vwap, 2));
    expect(result.closeNowPnlUsd).toBeCloseTo((vwap - 1_000) * 2 - fee(vwap, 2));
    expect(result.markPnlUsd).toBeCloseTo(1_000);
    expect(result.exitCostUsd).toBeCloseTo(1_000 - result.closeNowPnlUsd!);
    expect(result.giveBackPct).toBeCloseTo((result.exitCostUsd! / 1_000) * 100);
    expect(result.collarLimitUsd).toBe(1_000);
  });

  it('values a long with no bid at 0, flagged no_bid rather than at the mark', () => {
    const leg = makeLeg({ size: 3, entryPriceUsd: 20 });
    const book = makeBook([], [[40, 10]]);

    const result = evaluate(leg, 30, book);

    expect(result.status).toBe('no_bid');
    expect(result.filledSize).toBe(0);
    expect(result.exitVwapUsd).toBeNull();
    expect(result.feesUsd).toBe(0);
    expect(result.exitCashUsd).toBe(0);
    expect(result.closeNowPnlUsd).toBe(-60);
    expect(result.markPnlUsd).toBeCloseTo(30);
    expect(result.giveBackPct).toBeCloseTo(300);
    expect(result.spread?.widthPct).toBeNull();
  });

  it('prices only the fillable part of a long on a thin bid; the rest is worth 0', () => {
    const leg = makeLeg({ size: 5 });
    const book = makeBook([[1_400, 2]], [[1_600, 5]]);

    const result = evaluate(leg, 1_500, book);

    expect(result.status).toBe('partial');
    expect(result.filledSize).toBe(2);
    expect(result.size).toBe(5);
    expect(result.closeNowPnlUsd).toBeCloseTo(1_400 * 2 - fee(1_400, 2) - 1_000 * 5);
  });

  it('buys a short back on an ask that has run away from the mark', () => {
    const leg = makeLeg({ size: -2, entryPriceUsd: 2_000 });
    const book = makeBook([[1_400, 5]], [[1_900, 1], [2_100, 4]]);

    const result = evaluate(leg, 1_500, book);

    const vwap = (1_900 + 2_100) / 2;
    expect(result.status).toBe('ok');
    expect(result.side).toBe('buy');
    expect(result.markPnlUsd).toBeCloseTo(1_000);
    expect(result.closeNowPnlUsd).toBeCloseTo((2_000 - vwap) * 2 - fee(vwap, 2));
    expect(result.exitCashUsd).toBeCloseTo(-(vwap * 2 + fee(vwap, 2)));
    expect(result.giveBackPct).toBeGreaterThan(100);
    expect(result.collarLimitUsd).toBe(2_000);
    expect(result.spread?.widthPct).toBeCloseTo(((1_900 - 1_400) / 1_500) * 100);
  });

  it('leaves a short that cannot be fully bought back without a close-now P&L', () => {
    const leg = makeLeg({ size: -4, entryPriceUsd: 2_000 });

    const thin = evaluate(leg, 1_500, makeBook([[1_400, 5]], [[1_900, 1]]));
    expect(thin.status).toBe('partial');
    expect(thin.filledSize).toBe(1);
    expect(thin.closeNowPnlUsd).toBeNull();
    expect(thin.exitCostUsd).toBeNull();

    const empty = evaluate(leg, 1_500, makeBook([[1_400, 5]], []));
    expect(empty.status).toBe('no_ask');
    expect(empty.exitCashUsd).toBeNull();
    expect(empty.closeNowPnlUsd).toBeNull();
  });

  it('applies the premium cap to fees on a cheap option', () => {
    const leg = makeLeg({ size: 10, entryPriceUsd: 5 });
    const book = makeBook([[8, 10]], [[12, 10]]);

    const result = evaluate(leg, 10, book);

    // Uncapped: 0.015% × $100k = $15 per contract on an $8 option.
    expect(THALEX_OPTION_FEE_RATE * INDEX).toBeGreaterThan(CAP * 8);
    expect(result.feesUsd).toBeCloseTo(CAP * 8 * 10);
    expect(result.closeNowPnlUsd).toBeCloseTo((8 - 5) * 10 - CAP * 8 * 10);
  });
});

describe('exitVenueOf', () => {
  it('uses the holding venue and prices venue-neutral legs on Thalex', () => {
    expect(exitVenueOf(makeLeg())).toBe('thalex');
    expect(exitVenueOf(makeLeg({ venueHint: null, source: 'manual' }))).toBe('thalex');
    expect(exitVenueOf(makeLeg({ venueHint: null, source: 'deribit' }))).toBe('deribit');
    expect(exitVenueOf(makeLeg({ venueHint: 'okx', source: 'paper' }))).toBe('okx');
  });
});

function group(groupId: string, legIds: string[]): StrategyGroup {
  return {
    groupId,
    kind: 'call_spread',
    underlying: 'BTC',
    expiry: '2026-11-27',
    legIds,
    legs: [],
    netEntryPremiumUsd: 0,
    debitOrCredit: 'flat',
    maxProfitUsd: null,
    maxLossUsd: null,
    breakEvenSpotsUsd: [],
    grossDebitUsd: 0,
    grossCreditUsd: 0,
    totals: {
      netDeltaCoin: 0,
      netGammaUsd: 0,
      netVegaUsd: 0,
      netThetaUsd: 0,
      netVannaUsd: 0,
      netVolgaUsd: 0,
      unrealizedPnlUsd: 0,
    },
  };
}

describe('CloseNowTracker', () => {
  const longLeg = makeLeg({ legId: 'long', size: 1 });
  const shortLeg = makeLeg({ legId: 'short', strike: 120_000, size: -1, entryPriceUsd: 800 });
  const deribitLeg = makeLeg({ legId: 'deribit', venueHint: 'deribit', source: 'deribit' });

  function books(longBook: ExitBookLookup, shortBook: ExitBookLookup) {
    return (leg: PositionLeg): ExitBookLookup => {
      if (leg.legId === 'long') return longBook;
      if (leg.legId === 'short') return shortBook;
      return { kind: 'unsupported' };
    };
  }

  const longBook = makeBook([[1_400, 5]], [[1_600, 5]]);
  const shortBook = makeBook([[500, 5]], [[600, 5]], {
    instrument: 'BTC-27NOV26-120000-C',
    mark: { ...longBook.mark!, markPrice: 550 },
  });
  const withMarks = [
    { leg: longLeg, mark: makeMark(1_500) },
    { leg: shortLeg, mark: makeMark(550) },
  ];

  it('aggregates structures and the portfolio as the sum of their legs', () => {
    const tracker = new CloseNowTracker();
    const result = tracker.compute(
      withMarks,
      [group('spread', ['long', 'short'])],
      books({ kind: 'book', book: longBook }, { kind: 'book', book: shortBook }),
      NOW,
    );

    const [long, short] = result.legs;
    const legSum = long!.closeNowPnlUsd! + short!.closeNowPnlUsd!;
    expect(result.strategies[0]?.closeNowPnlUsd).toBeCloseTo(legSum);
    expect(result.portfolio.closeNowPnlUsd).toBeCloseTo(legSum);
    expect(result.portfolio.feesUsd).toBeCloseTo(long!.feesUsd + short!.feesUsd);
    expect(result.portfolio.exitCashUsd).toBeCloseTo(long!.exitCashUsd! + short!.exitCashUsd!);
    expect(result.portfolio.complete).toBe(true);
    expect(result.portfolio.exitCostUsd).toBeCloseTo(result.portfolio.markPnlUsd! - legSum);
  });

  it('keeps mark P&L identical to the existing open P&L', () => {
    const tracker = new CloseNowTracker();
    const result = tracker.compute(
      withMarks,
      [],
      books({ kind: 'book', book: longBook }, { kind: 'book', book: shortBook }),
      NOW,
    );
    expect(result.portfolio.markPnlUsd).toBeCloseTo(computeTotals(withMarks).unrealizedPnlUsd);
  });

  it('marks venues without depth books as unsupported and the aggregate as incomplete', () => {
    const tracker = new CloseNowTracker();
    const result = tracker.compute(
      [...withMarks, { leg: deribitLeg, mark: makeMark(1_500) }],
      [],
      books({ kind: 'book', book: longBook }, { kind: 'book', book: shortBook }),
      NOW,
    );
    expect(result.legs[2]?.status).toBe('unsupported_venue');
    expect(result.legs[2]?.venue).toBe('deribit');
    expect(result.portfolio.pricedLegCount).toBe(2);
    expect(result.portfolio.complete).toBe(false);
    expect(result.portfolio.exitCostUsd).toBeNull();
    expect(result.portfolio.giveBackPct).toBeNull();
  });

  it('shows the last usable value greyed out with its age once the book goes stale', () => {
    const tracker = new CloseNowTracker();
    const fresh = tracker.compute(
      withMarks,
      [],
      books({ kind: 'book', book: longBook }, { kind: 'book', book: shortBook }),
      NOW,
    );
    const later = NOW + 5_000;
    const unsynced = makeBook([], [], { state: 'unsynchronized', receivedAt: later });
    const stale = tracker.compute(
      withMarks,
      [],
      books({ kind: 'book', book: unsynced }, { kind: 'book', book: { ...shortBook, receivedAt: later, mark: { ...shortBook.mark!, receivedAt: later } } }),
      later,
    );

    const long = stale.legs[0]!;
    expect(long.stale).toBe(true);
    expect(long.unavailableReason).toBe('unsynchronized');
    expect(long.closeNowPnlUsd).toBeCloseTo(fresh.legs[0]!.closeNowPnlUsd!);
    expect(long.bookAgeMs).toBe(5_000);
    expect(stale.portfolio.stale).toBe(true);
  });

  it('flags crossed and silent books, and reports a book that never synced as unavailable', () => {
    const tracker = new CloseNowTracker();
    const crossed = tracker.compute(
      withMarks,
      [],
      books({ kind: 'book', book: makeBook([[1_700, 1]], [[1_600, 1]], { crossed: true }) }, { kind: 'unavailable', reason: 'loading' }),
      NOW,
    );
    expect(crossed.legs[0]?.status).toBe('book_unavailable');
    expect(crossed.legs[0]?.unavailableReason).toBe('crossed');
    expect(crossed.legs[1]?.unavailableReason).toBe('loading');

    const silentAt = NOW + CLOSE_NOW_BOOK_SILENCE_MS + 1;
    const silent = new CloseNowTracker().compute(
      withMarks,
      [],
      books({ kind: 'book', book: longBook }, { kind: 'book', book: shortBook }),
      silentAt,
    );
    expect(silent.legs[0]?.unavailableReason).toBe('silent');
  });

  it('tracks the peak close-now P&L after it falls, and resets when the size changes', () => {
    const tracker = new CloseNowTracker();
    const at = (ms: number, bid: number) =>
      makeBook([[bid, 5]], [[bid + 200, 5]], {
        receivedAt: ms,
        mark: { ...longBook.mark!, receivedAt: ms },
      });
    const run = (ms: number, bid: number, leg = longLeg) =>
      tracker.compute([{ leg, mark: makeMark(1_500) }], [], () => ({ kind: 'book', book: at(ms, bid) }), ms);

    run(NOW, 1_400);
    const high = run(NOW + 1_000, 1_600).legs[0]!;
    const low = run(NOW + 2_000, 1_200);

    expect(low.legs[0]?.peak?.closeNowPnlUsd).toBeCloseTo(high.closeNowPnlUsd!);
    expect(low.legs[0]?.peak?.atMs).toBe(NOW + 1_000);
    expect(low.portfolio.peak?.closeNowPnlUsd).toBeCloseTo(high.closeNowPnlUsd!);

    const resized = run(NOW + 3_000, 1_200, { ...longLeg, size: 2 });
    expect(resized.legs[0]?.peak?.atMs).toBe(NOW + 3_000);
  });

  it('compares the spread with its recent typical width once enough samples exist', () => {
    const tracker = new CloseNowTracker();
    const at = (ms: number, ask: number) =>
      makeBook([[1_450, 5]], [[ask, 5]], { receivedAt: ms, mark: { ...longBook.mark!, receivedAt: ms } });
    let last = null;
    for (let i = 0; i < CLOSE_NOW_SPREAD_MIN_SAMPLES; i += 1) {
      const ms = NOW + i * CLOSE_NOW_SPREAD_SAMPLE_MS;
      last = tracker.compute([{ leg: longLeg, mark: makeMark(1_500) }], [], () => ({ kind: 'book', book: at(ms, 1_480) }), ms);
    }
    expect(last?.legs[0]?.spread?.typicalWidthPct).toBeCloseTo(2);

    const ms = NOW + CLOSE_NOW_SPREAD_MIN_SAMPLES * CLOSE_NOW_SPREAD_SAMPLE_MS;
    const wide = tracker.compute([{ leg: longLeg, mark: makeMark(1_500) }], [], () => ({ kind: 'book', book: at(ms, 1_570) }), ms);
    expect(wide.legs[0]?.spread?.widthPct).toBeCloseTo(8);
    expect(wide.legs[0]?.spread?.widthVsTypical).toBeGreaterThan(1);
  });
});
