import { describe, expect, it } from 'vitest';
import type { VenueId } from '@oggregator/core';
import { fillCashDelta } from '../book/fill.js';
import type { Order, OrderLeg } from '../book/order.js';
import { applyFillToPosition } from '../book/position.js';
import { FixedClock } from '../gateways/clock.js';
import type { QuoteBook, QuoteKey, QuoteProvider } from '../gateways/quote-provider.js';
import type { FillModel } from '../gateways/fill-model.js';
import { PaperFillEngine } from './paper-fill-engine.js';
import { RealisticFillModel } from './realistic-fill-model.js';

class StubQuotes implements QuoteProvider {
  constructor(private readonly byStrike: Map<number, QuoteBook[]>) {}
  async getBooks(key: QuoteKey): Promise<QuoteBook[]> {
    return this.byStrike.get(key.strike) ?? [];
  }
  async getMark(): Promise<number | null> {
    return null;
  }
}

function book(overrides: Partial<QuoteBook>): QuoteBook {
  return {
    venue: 'deribit' as VenueId,
    exchangeSymbol: 'BTC-29MAY26-78000-C',
    settleCurrency: 'BTC',
    inverse: true,
    quantityUnit: 'base',
    contractMultiplierBase: 1,
    nativeMinQuantity: 0.1,
    nativeQuantityStep: 0.1,
    nativePriceTick: 0.0001,
    minQuantity: 0.1,
    quantityStep: 0.1,
    bidUsd: 100,
    askUsd: 110,
    markUsd: 105,
    markIv: 0.6,
    underlyingPriceUsd: 78_000,
    bidTakerFeeUsd: 0,
    askTakerFeeUsd: 0,
    bidSize: null,
    askSize: null,
    asOfMs: Date.parse('2026-04-23T00:00:00Z'),
    ...overrides,
  };
}

function single(byStrike: Map<number, QuoteBook>): StubQuotes {
  const wrapped = new Map<number, QuoteBook[]>();
  for (const [k, v] of byStrike) wrapped.set(k, [v]);
  return new StubQuotes(wrapped);
}

function order(legs: Array<Omit<OrderLeg, 'index' | 'quantityUnit'>>): Order {
  return {
    id: 'ord_test',
    clientOrderId: 'cid_test',
    accountId: 'acc_test',
    mode: 'paper',
    kind: 'market',
    status: 'accepted',
    legs: legs.map((leg, index) => ({ ...leg, index, quantityUnit: 'base' })),
    submittedAt: new Date('2026-04-23T00:00:00Z'),
    filledAt: null,
    rejectionReason: null,
    totalDebitUsd: null,
  };
}

const clock = new FixedClock(new Date('2026-04-23T00:00:00Z'));

describe('PaperFillEngine', () => {
  it.each([
    ['missing', null],
    ['zero', 0],
    ['non-finite', Number.NaN],
    ['future', Date.parse('2026-04-23T00:00:00.001Z')],
    ['stale', Date.parse('2026-04-22T23:58:59.999Z')],
  ])('rejects a quote with a %s source timestamp', async (_case, asOfMs) => {
    const quotes = single(new Map([[78_000, book({ askUsd: 100, asOfMs })]]));
    const engine = new PaperFillEngine(quotes, clock);

    await expect(
      engine.executeOrder(
        order([
          {
            side: 'buy',
            optionRight: 'call',
            underlying: 'BTC',
            expiry: '2026-05-29',
            strike: 78_000,
            quantity: 1,
            preferredVenues: null,
          },
        ]),
        [],
      ),
    ).rejects.toMatchObject({ code: 'NO_LIQUIDITY', legIndex: 0 });
  });

  it('accepts a quote exactly at the maximum age', async () => {
    const quotes = single(
      new Map([[78_000, book({ askUsd: 100, asOfMs: Date.parse('2026-04-22T23:59:00.000Z') })]]),
    );
    const engine = new PaperFillEngine(quotes, clock);

    const fills = await engine.executeOrder(
      order([
        {
          side: 'buy',
          optionRight: 'call',
          underlying: 'BTC',
          expiry: '2026-05-29',
          strike: 78_000,
          quantity: 1,
          preferredVenues: null,
        },
      ]),
      [],
    );

    expect(fills[0]?.priceUsd).toBe(100);
  });

  it('selects a fresh venue instead of a better-priced stale venue', async () => {
    const quotes = new StubQuotes(
      new Map([
        [
          78_000,
          [
            book({
              venue: 'okx' as VenueId,
              askUsd: 90,
              asOfMs: Date.parse('2026-04-22T23:58:59.999Z'),
            }),
            book({ venue: 'deribit' as VenueId, askUsd: 100 }),
          ],
        ],
      ]),
    );
    const engine = new PaperFillEngine(quotes, clock);

    const fills = await engine.executeOrder(
      order([
        {
          side: 'buy',
          optionRight: 'call',
          underlying: 'BTC',
          expiry: '2026-05-29',
          strike: 78_000,
          quantity: 1,
          preferredVenues: null,
        },
      ]),
      [],
    );

    expect(fills[0]?.venue).toBe('deribit');
    expect(fills[0]?.priceUsd).toBe(100);
  });

  it('applies fees as USD-per-base-unit multiplied by base quantity', async () => {
    const quotes = single(
      new Map([[78_000, book({ bidUsd: 3_000, askUsd: 3_095, askTakerFeeUsd: 23.4 })]]),
    );
    const engine = new PaperFillEngine(quotes, clock);
    const fills = await engine.executeOrder(
      order([
        {
          side: 'buy',
          optionRight: 'call',
          underlying: 'BTC',
          expiry: '2026-05-29',
          strike: 78_000,
          quantity: 1,
          preferredVenues: null,
        },
      ]),
      [],
    );
    expect(fills).toHaveLength(1);
    expect(fills[0]!.priceUsd).toBe(3_095);
    expect(fills[0]!.feesUsd).toBeCloseTo(23.4, 6);
  });

  it('scales fees by quantity', async () => {
    const quotes = single(
      new Map([[78_000, book({ askUsd: 500, askTakerFeeUsd: 10 })]]),
    );
    const engine = new PaperFillEngine(quotes, clock);
    const fills = await engine.executeOrder(
      order([
        {
          side: 'buy',
          optionRight: 'call',
          underlying: 'BTC',
          expiry: '2026-05-29',
          strike: 78_000,
          quantity: 5,
          preferredVenues: null,
        },
      ]),
      [],
    );
    expect(fills[0]!.feesUsd).toBeCloseTo(50, 6);
  });

  it('rejects a base quantity below the venue minimum', async () => {
    const quotes = single(new Map([[78_000, book({ minQuantity: 0.1, quantityStep: 0.1 })]]));
    const engine = new PaperFillEngine(quotes, clock);

    await expect(
      engine.executeOrder(
        order([
          {
            side: 'buy',
            optionRight: 'call',
            underlying: 'BTC',
            expiry: '2026-05-29',
            strike: 78_000,
            quantity: 0.05,
            preferredVenues: null,
          },
        ]),
        [],
      ),
    ).rejects.toMatchObject({ code: 'NO_LIQUIDITY', legIndex: 0 });
  });

  it('rejects a base quantity that is off the venue step', async () => {
    const quotes = single(new Map([[78_000, book({ minQuantity: 0.1, quantityStep: 0.1 })]]));
    const engine = new PaperFillEngine(quotes, clock);

    await expect(
      engine.executeOrder(
        order([
          {
            side: 'buy',
            optionRight: 'call',
            underlying: 'BTC',
            expiry: '2026-05-29',
            strike: 78_000,
            quantity: 0.15,
            preferredVenues: null,
          },
        ]),
        [],
      ),
    ).rejects.toMatchObject({ code: 'NO_LIQUIDITY', legIndex: 0 });
  });

  it('routes by fee-inclusive cost for equal base exposure', async () => {
    const quotes = new StubQuotes(
      new Map([
        [
          78_000,
          [
            book({ venue: 'okx', askUsd: 90, askTakerFeeUsd: 20 }),
            book({ venue: 'deribit', askUsd: 100, askTakerFeeUsd: 1 }),
          ],
        ],
      ]),
    );
    const engine = new PaperFillEngine(quotes, clock);

    const fills = await engine.executeOrder(
      order([
        {
          side: 'buy',
          optionRight: 'call',
          underlying: 'BTC',
          expiry: '2026-05-29',
          strike: 78_000,
          quantity: 1,
          preferredVenues: null,
        },
      ]),
      [],
    );

    expect(fills[0]?.venue).toBe('deribit');
  });

  it('skips a cheaper venue with a non-positive executable price', async () => {
    const quotes = new StubQuotes(
      new Map([
        [
          78_000,
          [
            book({ venue: 'okx', askUsd: -1 }),
            book({ venue: 'deribit', askUsd: 100 }),
          ],
        ],
      ]),
    );
    const engine = new PaperFillEngine(quotes, clock);

    const fills = await engine.executeOrder(
      order([
        {
          side: 'buy',
          optionRight: 'call',
          underlying: 'BTC',
          expiry: '2026-05-29',
          strike: 78_000,
          quantity: 1,
          preferredVenues: null,
        },
      ]),
      [],
    );

    expect(fills[0]?.venue).toBe('deribit');
  });

  it('rejects when every permitted venue has an invalid executable price', async () => {
    const engine = new PaperFillEngine(
      single(new Map([[78_000, book({ askUsd: Number.NaN })]])),
      clock,
    );

    await expect(
      engine.executeOrder(
        order([
          {
            side: 'buy',
            optionRight: 'call',
            underlying: 'BTC',
            expiry: '2026-05-29',
            strike: 78_000,
            quantity: 1,
            preferredVenues: null,
          },
        ]),
        [],
      ),
    ).rejects.toMatchObject({ code: 'NO_LIQUIDITY', legIndex: 0 });
  });

  it('rejects malformed fill-model output before producing fills', async () => {
    const fillModel: FillModel = {
      quote: () => ({
        priceUsd: Number.NaN,
        filledQuantity: 2,
        slippageUsd: -1,
        partial: false,
      }),
    };
    const engine = new PaperFillEngine(
      single(new Map([[78_000, book({ askUsd: 100 })]])),
      clock,
      fillModel,
    );

    await expect(
      engine.executeOrder(
        order([
          {
            side: 'buy',
            optionRight: 'call',
            underlying: 'BTC',
            expiry: '2026-05-29',
            strike: 78_000,
            quantity: 1,
            preferredVenues: null,
          },
        ]),
        [],
      ),
    ).rejects.toMatchObject({ code: 'NO_LIQUIDITY', legIndex: 0 });
  });

  it('uses venue ID as the deterministic all-in cost tie-break', async () => {
    const quotes = new StubQuotes(
      new Map([
        [
          78_000,
          [
            book({ venue: 'okx', askUsd: 100, askTakerFeeUsd: 1 }),
            book({ venue: 'deribit', askUsd: 100, askTakerFeeUsd: 1 }),
          ],
        ],
      ]),
    );
    const engine = new PaperFillEngine(quotes, clock);

    const fills = await engine.executeOrder(
      order([
        {
          side: 'buy',
          optionRight: 'call',
          underlying: 'BTC',
          expiry: '2026-05-29',
          strike: 78_000,
          quantity: 1,
          preferredVenues: null,
        },
      ]),
      [],
    );

    expect(fills[0]?.venue).toBe('deribit');
  });

  it('does not let preferred venues escape the order venue filter', async () => {
    const quotes = new StubQuotes(
      new Map([[78_000, [book({ venue: 'okx' }), book({ venue: 'deribit' })]]]),
    );
    const engine = new PaperFillEngine(quotes, clock);

    await expect(
      engine.executeOrder(
        order([
          {
            side: 'buy',
            optionRight: 'call',
            underlying: 'BTC',
            expiry: '2026-05-29',
            strike: 78_000,
            quantity: 1,
            preferredVenues: ['okx'],
          },
        ]),
        ['deribit'],
      ),
    ).rejects.toMatchObject({ code: 'NO_LIQUIDITY', legIndex: 0 });
  });

  it('records native context without multiplying base accounting twice', async () => {
    const quotes = single(
      new Map([
        [
          78_000,
          book({
            venue: 'okx',
            contractMultiplierBase: 0.01,
            nativeMinQuantity: 1,
            nativeQuantityStep: 1,
            minQuantity: 0.01,
            quantityStep: 0.01,
            askUsd: 4_200,
            askTakerFeeUsd: 21,
          }),
        ],
      ]),
    );
    const engine = new PaperFillEngine(quotes, clock);

    const fills = await engine.executeOrder(
      order([
        {
          side: 'buy',
          optionRight: 'call',
          underlying: 'BTC',
          expiry: '2026-05-29',
          strike: 78_000,
          quantity: 0.05,
          preferredVenues: null,
        },
      ]),
      [],
    );

    expect(fills[0]).toMatchObject({
      quantity: 0.05,
      requestedQuantity: 0.05,
      quantityUnit: 'base',
      contractMultiplierBase: 0.01,
      nativeQuantity: 5,
      requestedNativeQuantity: 5,
      nativeMinQuantity: 1,
      nativeQuantityStep: 1,
      nativePriceTick: 0.0001,
      feesUsd: 1.05,
    });
    const fill = fills[0];
    if (!fill) throw new Error('missing fill');
    expect(applyFillToPosition(null, fill).netQuantity).toBe(0.05);
    expect(fillCashDelta(fill)).toBe(-211.05);
  });

  it('propagates the venue mark IV onto the produced Fill', async () => {
    const quotes = single(
      new Map([[78_000, book({ askUsd: 3_095, markIv: 0.4275, askTakerFeeUsd: 0 })]]),
    );
    const engine = new PaperFillEngine(quotes, clock);
    const fills = await engine.executeOrder(
      order([
        {
          side: 'buy',
          optionRight: 'call',
          underlying: 'BTC',
          expiry: '2026-05-29',
          strike: 78_000,
          quantity: 1,
          preferredVenues: null,
        },
      ]),
      [],
    );
    expect(fills[0]!.iv).toBe(0.4275);
  });

  it('passes through a null venue mark IV as Fill.iv = null', async () => {
    const quotes = single(
      new Map([[78_000, book({ askUsd: 3_095, markIv: null, askTakerFeeUsd: 0 })]]),
    );
    const engine = new PaperFillEngine(quotes, clock);
    const fills = await engine.executeOrder(
      order([
        {
          side: 'buy',
          optionRight: 'call',
          underlying: 'BTC',
          expiry: '2026-05-29',
          strike: 78_000,
          quantity: 1,
          preferredVenues: null,
        },
      ]),
      [],
    );
    expect(fills[0]!.iv).toBeNull();
  });

  it('defaults to zero fees when venue provides no estimate', async () => {
    const quotes = single(
      new Map([[78_000, book({ askUsd: 3_095, askTakerFeeUsd: 0 })]]),
    );
    const engine = new PaperFillEngine(quotes, clock);
    const fills = await engine.executeOrder(
      order([
        {
          side: 'buy',
          optionRight: 'call',
          underlying: 'BTC',
          expiry: '2026-05-29',
          strike: 78_000,
          quantity: 1,
          preferredVenues: null,
        },
      ]),
      [],
    );
    expect(fills[0]!.feesUsd).toBe(0);
  });

  it('bull call spread: two-leg fill produces separate fees per leg', async () => {
    const quotes = single(
      new Map([
        [78_000, book({ bidUsd: 4_000, askUsd: 4_005, askTakerFeeUsd: 23 })],
        [79_000, book({ bidUsd: 3_520, askUsd: 3_530, bidTakerFeeUsd: 23 })],
      ]),
    );
    const engine = new PaperFillEngine(quotes, clock);
    const fills = await engine.executeOrder(
      order([
        {
          side: 'buy',
          optionRight: 'call',
          underlying: 'BTC',
          expiry: '2026-05-29',
          strike: 78_000,
          quantity: 1,
          preferredVenues: null,
        },
        {
          side: 'sell',
          optionRight: 'call',
          underlying: 'BTC',
          expiry: '2026-05-29',
          strike: 79_000,
          quantity: 1,
          preferredVenues: null,
        },
      ]),
      [],
    );
    expect(fills).toHaveLength(2);
    expect(fills[0]!.priceUsd).toBe(4_005);
    expect(fills[0]!.feesUsd).toBe(23);
    expect(fills[1]!.priceUsd).toBe(3_520);
    expect(fills[1]!.feesUsd).toBe(23);
  });

  it('optimistic mode: zero slippage, no partial fills, even when oversized', async () => {
    const quotes = single(
      new Map([[78_000, book({ askUsd: 100, askSize: 1, askTakerFeeUsd: 0 })]]),
    );
    const engine = new PaperFillEngine(quotes, clock);
    const fills = await engine.executeOrder(
      order([
        {
          side: 'buy',
          optionRight: 'call',
          underlying: 'BTC',
          expiry: '2026-05-29',
          strike: 78_000,
          quantity: 100,
          preferredVenues: null,
        },
      ]),
      [],
    );
    expect(fills[0]!.slippageUsd).toBe(0);
    expect(fills[0]!.partialFill).toBe(false);
    expect(fills[0]!.quantity).toBe(100);
    expect(fills[0]!.requestedQuantity).toBe(100);
  });

  it('realistic mode: order within L1 size pays no slippage', async () => {
    const quotes = single(
      new Map([[78_000, book({ bidUsd: 99, askUsd: 101, askSize: 5, bidSize: 5 })]]),
    );
    const engine = new PaperFillEngine(quotes, clock, new RealisticFillModel());
    const fills = await engine.executeOrder(
      order([
        {
          side: 'buy',
          optionRight: 'call',
          underlying: 'BTC',
          expiry: '2026-05-29',
          strike: 78_000,
          quantity: 3,
          preferredVenues: null,
        },
      ]),
      [],
    );
    expect(fills[0]!.priceUsd).toBe(101);
    expect(fills[0]!.slippageUsd).toBe(0);
    expect(fills[0]!.partialFill).toBe(false);
  });

  it('realistic mode: oversized order pays spread penalty when no L2 ladder', async () => {
    const quotes = single(
      new Map([[78_000, book({ bidUsd: 99, askUsd: 101, askSize: 1, bidSize: 1 })]]),
    );
    const engine = new PaperFillEngine(quotes, clock, new RealisticFillModel());
    const fills = await engine.executeOrder(
      order([
        {
          side: 'buy',
          optionRight: 'call',
          underlying: 'BTC',
          expiry: '2026-05-29',
          strike: 78_000,
          quantity: 5,
          preferredVenues: null,
        },
      ]),
      [],
    );
    expect(fills[0]!.priceUsd).toBeGreaterThan(101);
    expect(fills[0]!.slippageUsd).toBeGreaterThan(0);
    expect(fills[0]!.partialFill).toBe(false);
  });

  it('realistic mode: VWAP-walks an L2 ladder', async () => {
    const quotes = single(
      new Map([
        [
          78_000,
          book({
            bidUsd: 99,
            askUsd: 100,
            askSize: 2,
            bidSize: 2,
            askLevels: [
              { priceUsd: 100, size: 2 },
              { priceUsd: 102, size: 3 },
              { priceUsd: 105, size: 5 },
            ],
          }),
        ],
      ]),
    );
    const engine = new PaperFillEngine(quotes, clock, new RealisticFillModel());
    const fills = await engine.executeOrder(
      order([
        {
          side: 'buy',
          optionRight: 'call',
          underlying: 'BTC',
          expiry: '2026-05-29',
          strike: 78_000,
          quantity: 5,
          preferredVenues: null,
        },
      ]),
      [],
    );
    // 2@100 + 3@102 = 506, vwap 101.2
    expect(fills[0]!.priceUsd).toBeCloseTo(101.2, 4);
    expect(fills[0]!.slippageUsd).toBeCloseTo(1.2, 4);
    expect(fills[0]!.quantity).toBe(5);
  });

  it('realistic mode: ladder thinner than request returns partial fill', async () => {
    const quotes = single(
      new Map([
        [
          78_000,
          book({
            bidUsd: 99,
            askUsd: 100,
            askSize: 1,
            bidSize: 1,
            askLevels: [
              { priceUsd: 100, size: 1 },
              { priceUsd: 102, size: 1 },
            ],
          }),
        ],
      ]),
    );
    const engine = new PaperFillEngine(quotes, clock, new RealisticFillModel());
    const fills = await engine.executeOrder(
      order([
        {
          side: 'buy',
          optionRight: 'call',
          underlying: 'BTC',
          expiry: '2026-05-29',
          strike: 78_000,
          quantity: 5,
          preferredVenues: null,
        },
      ]),
      [],
    );
    expect(fills[0]!.quantity).toBe(2);
    expect(fills[0]!.requestedQuantity).toBe(5);
    expect(fills[0]!.partialFill).toBe(true);
  });
});
