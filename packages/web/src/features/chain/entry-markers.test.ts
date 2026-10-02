import { describe, expect, it } from 'vitest';
import type { ExchangePortfolioTrade, InstrumentCandle, PaperFillDto } from '@oggregator/protocol';
import {
  buildBreakEvenLines,
  buildEntryMarkers,
  costBasisFromEntries,
  exchangeTradeEntries,
  paperFillEntries,
  snapToBarTs,
  toChartPrice,
  type InstrumentEntry,
  type InstrumentKey,
} from './entry-markers.js';

const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 9, 1, 0, 0, 0);

const key: InstrumentKey = {
  venue: 'deribit',
  underlying: 'BTC',
  expiry: '2026-10-30',
  strike: 70_000,
  type: 'call',
};

function candle(ts: number): InstrumentCandle {
  return { ts, o: 0.05, h: 0.06, l: 0.04, c: 0.05, vol: 1, synthetic: false };
}

const candles = [candle(T0), candle(T0 + HOUR), candle(T0 + 2 * HOUR)];

function fill(overrides: Partial<PaperFillDto>): PaperFillDto {
  return {
    id: 'f1',
    orderId: 'o1',
    legIndex: 0,
    venue: 'deribit',
    side: 'buy',
    optionRight: 'call',
    underlying: 'BTC',
    expiry: '2026-10-30',
    strike: 70_000,
    quantity: 0.5,
    requestedQuantity: 0.5,
    quantityUnit: 'base',
    contractMultiplierBase: null,
    nativeQuantity: null,
    requestedNativeQuantity: null,
    nativeMinQuantity: null,
    nativeQuantityStep: null,
    nativePriceTick: null,
    priceUsd: 3_000,
    feesUsd: 1,
    slippageUsd: 0,
    partialFill: false,
    benchmarkBidUsd: null,
    benchmarkAskUsd: null,
    benchmarkMidUsd: null,
    underlyingSpotUsd: 60_000,
    filledAt: new Date(T0 + HOUR + 10 * 60_000).toISOString(),
    ...overrides,
  };
}

function trade(overrides: Partial<ExchangePortfolioTrade>): ExchangePortfolioTrade {
  return {
    venue: 'derive',
    tradeId: 't1',
    orderId: null,
    groupId: null,
    instrumentName: 'BTC-20261030-70000-C',
    underlying: 'BTC',
    expiry: '2026-10-30',
    strike: 70_000,
    optionRight: 'call',
    direction: 'sell',
    amount: 1,
    priceUsd: 2_500,
    feeUsd: null,
    realizedPnlUsd: null,
    liquidityRole: 'maker',
    timestampMs: T0 + 30 * 60_000,
    ...overrides,
  };
}

function entry(overrides: Partial<InstrumentEntry>): InstrumentEntry {
  return {
    id: 'e1',
    source: 'paper',
    side: 'buy',
    quantity: 1,
    priceUsd: 3_000,
    feeUsd: null,
    spotUsd: 60_000,
    ts: T0 + HOUR,
    ...overrides,
  };
}

describe('paperFillEntries', () => {
  it('keeps only fills on the chart venue and instrument', () => {
    const fills = [
      fill({ id: 'match' }),
      fill({ id: 'other-venue', venue: 'okx' }),
      fill({ id: 'other-strike', strike: 75_000 }),
      fill({ id: 'other-right', optionRight: 'put' }),
      fill({ id: 'other-expiry', expiry: '2026-11-27' }),
    ];
    expect(paperFillEntries(fills, key).map((e) => e.id)).toEqual(['paper:match']);
  });

  it('carries the spot recorded at fill time', () => {
    const [e] = paperFillEntries([fill({})], key);
    expect(e).toMatchObject({ side: 'buy', quantity: 0.5, priceUsd: 3_000, spotUsd: 60_000 });
    expect(e!.ts).toBe(T0 + HOUR + 10 * 60_000);
  });
});

describe('exchangeTradeEntries', () => {
  it('filters by venue and maps direction to side', () => {
    const deriveKey = { ...key, venue: 'derive' as const };
    const entries = exchangeTradeEntries(
      [trade({}), trade({ tradeId: 't2', venue: 'thalex' })],
      deriveKey,
    );
    expect(entries).toEqual([
      {
        id: 'exchange:derive:t1',
        source: 'exchange',
        side: 'sell',
        quantity: 1,
        priceUsd: 2_500,
        feeUsd: null,
        spotUsd: null,
        ts: T0 + 30 * 60_000,
      },
    ]);
  });
});

describe('toChartPrice', () => {
  it('passes USD through on USD-quoted charts', () => {
    expect(toChartPrice(entry({}), 'USD', null)).toBe(3_000);
    expect(toChartPrice(entry({}), null, null)).toBe(3_000);
  });

  it('converts to coin using the spot at fill time on inverse charts', () => {
    expect(toChartPrice(entry({ spotUsd: 60_000 }), 'BTC', 75_000)).toBeCloseTo(0.05);
  });

  it('falls back to current spot only when the fill has none', () => {
    expect(toChartPrice(entry({ spotUsd: null }), 'BTC', 75_000)).toBeCloseTo(0.04);
    expect(toChartPrice(entry({ spotUsd: null }), 'BTC', null)).toBeNull();
  });
});

describe('snapToBarTs', () => {
  it('lands on the bar containing the fill', () => {
    expect(snapToBarTs(T0, candles)).toBe(T0);
    expect(snapToBarTs(T0 + HOUR + 1, candles)).toBe(T0 + HOUR);
    expect(snapToBarTs(T0 + 5 * HOUR, candles)).toBe(T0 + 2 * HOUR);
  });

  it('drops fills before the loaded range', () => {
    expect(snapToBarTs(T0 - 1, candles)).toBeNull();
    expect(snapToBarTs(T0, [])).toBeNull();
    expect(snapToBarTs(Number.NaN, candles)).toBeNull();
  });
});

describe('buildEntryMarkers', () => {
  it('builds sorted markers in chart units and skips unplaceable entries', () => {
    const markers = buildEntryMarkers(
      [
        entry({ id: 'late', ts: T0 + 2 * HOUR + 5, side: 'sell', priceUsd: 3_600 }),
        entry({ id: 'early', ts: T0 + 1 }),
        entry({ id: 'too-old', ts: T0 - HOUR }),
        entry({ id: 'no-spot', spotUsd: null }),
      ],
      candles,
      'BTC',
      null,
      4,
    );
    expect(markers.map((m) => m.id)).toEqual(['early', 'late']);
    expect(markers[0]).toMatchObject({ barTs: T0, side: 'buy', text: 'B 1 @ 0.0500 · paper' });
    expect(markers[1]!.price).toBeCloseTo(0.06);
  });
});

describe('costBasisFromEntries', () => {
  it('averages adds and includes entry fees', () => {
    const basis = costBasisFromEntries(
      [
        entry({ id: 'a', ts: 1, quantity: 1, priceUsd: 100, feeUsd: 2 }),
        entry({ id: 'b', ts: 2, quantity: 1, priceUsd: 200, feeUsd: 0 }),
      ],
      'USD',
      null,
    );
    expect(basis).toEqual({ netQuantity: 2, price: 151 });
  });

  it('keeps the basis through partial closes and drops it when flat', () => {
    const open = entry({ id: 'a', ts: 1, quantity: 2, priceUsd: 100 });
    const partial = entry({ id: 'b', ts: 2, side: 'sell', quantity: 1, priceUsd: 300 });
    expect(costBasisFromEntries([partial, open], 'USD', null)).toEqual({ netQuantity: 1, price: 100 });
    const close = entry({ id: 'c', ts: 3, side: 'sell', quantity: 1, priceUsd: 50 });
    expect(costBasisFromEntries([open, partial, close], 'USD', null)).toBeNull();
  });

  it('restarts the basis on a flip and nets fees against shorts', () => {
    const basis = costBasisFromEntries(
      [
        entry({ id: 'a', ts: 1, quantity: 1, priceUsd: 100 }),
        entry({ id: 'b', ts: 2, side: 'sell', quantity: 3, priceUsd: 90, feeUsd: 3 }),
      ],
      'USD',
      null,
    );
    expect(basis).toEqual({ netQuantity: -2, price: 89 });
  });

  it('works in coin units on inverse charts', () => {
    const basis = costBasisFromEntries([entry({ priceUsd: 3_000, spotUsd: 60_000 })], 'BTC', null);
    expect(basis?.price).toBeCloseTo(0.05);
  });
});

describe('buildBreakEvenLines', () => {
  const liveBuy = entry({ id: 'x', source: 'exchange', quantity: 1, priceUsd: 1_000, feeUsd: 10, spotUsd: null });

  it('uses the fill replay when it agrees with the venue position', () => {
    const lines = buildBreakEvenLines([liveBuy], 'USD', null, { size: 1, entryPriceUsd: 1_000 });
    expect(lines).toEqual([{ id: 'be:exchange', source: 'exchange', price: 1_010, netQuantity: 1 }]);
  });

  it('falls back to the venue entry price when trade history is incomplete', () => {
    const lines = buildBreakEvenLines([liveBuy], 'USD', null, { size: 3, entryPriceUsd: 1_200 });
    expect(lines).toEqual([{ id: 'be:exchange', source: 'exchange', price: 1_200, netQuantity: 3 }]);
  });

  it('hides the live line when the connected venue is flat', () => {
    expect(buildBreakEvenLines([liveBuy], 'USD', null, null)).toEqual([]);
  });

  it('uses the replay when the venue is not connected, alongside a paper line', () => {
    const lines = buildBreakEvenLines(
      [liveBuy, entry({ id: 'p', source: 'paper', priceUsd: 500, feeUsd: null })],
      'USD',
      null,
      undefined,
    );
    expect(lines.map((l) => [l.id, l.price])).toEqual([
      ['be:paper', 500],
      ['be:exchange', 1_010],
    ]);
  });
});
