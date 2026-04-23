import { describe, expect, it } from 'vitest';
import type { VenueId } from '@oggregator/core';
import type { Order, OrderLeg } from '../book/order.js';
import { FixedClock } from '../gateways/clock.js';
import type { QuoteBook, QuoteKey, QuoteProvider } from '../gateways/quote-provider.js';
import { PaperFillEngine } from './paper-fill-engine.js';

class StubQuotes implements QuoteProvider {
  constructor(private readonly byStrike: Map<number, QuoteBook>) {}
  async getBooks(key: QuoteKey): Promise<QuoteBook[]> {
    const book = this.byStrike.get(key.strike);
    return book ? [book] : [];
  }
  async getMark(): Promise<number | null> {
    return null;
  }
}

function book(overrides: Partial<QuoteBook>): QuoteBook {
  return {
    venue: 'deribit' as VenueId,
    bidUsd: 100,
    askUsd: 110,
    markUsd: 105,
    underlyingPriceUsd: 78_000,
    feesTakerUsd: 0,
    ...overrides,
  };
}

function order(legs: Array<Omit<OrderLeg, 'index'>>): Order {
  return {
    id: 'ord_test',
    clientOrderId: 'cid_test',
    accountId: 'acc_test',
    mode: 'paper',
    kind: 'market',
    status: 'accepted',
    legs: legs.map((leg, index) => ({ ...leg, index })),
    submittedAt: new Date('2026-04-23T00:00:00Z'),
    filledAt: null,
    rejectionReason: null,
    totalDebitUsd: null,
  };
}

const clock = new FixedClock(new Date('2026-04-23T00:00:00Z'));

describe('PaperFillEngine', () => {
  it('applies fees as USD-per-contract × quantity, not price × rate', async () => {
    const quotes = new StubQuotes(
      new Map([[78_000, book({ bidUsd: 3_000, askUsd: 3_095, feesTakerUsd: 23.4 })]]),
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
    const quotes = new StubQuotes(
      new Map([[78_000, book({ askUsd: 500, feesTakerUsd: 10 })]]),
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

  it('defaults to zero fees when venue provides no estimate', async () => {
    const quotes = new StubQuotes(
      new Map([[78_000, book({ askUsd: 3_095, feesTakerUsd: 0 })]]),
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
    const quotes = new StubQuotes(
      new Map([
        [78_000, book({ bidUsd: 4_000, askUsd: 4_005, feesTakerUsd: 23 })],
        [79_000, book({ bidUsd: 3_520, askUsd: 3_530, feesTakerUsd: 23 })],
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
});
