import { describe, it, expect } from 'vitest';
import {
  PaperOrderLegSchema,
  PlaceOrderRequestSchema,
  CreatePaperTradeRequestSchema,
  CreatePaperTradeNoteRequestSchema,
  ReducePaperTradeRequestSchema,
  InitPaperAccountRequestSchema,
} from './paper.js';

const validLeg = {
  index: 0,
  side: 'buy',
  optionRight: 'call',
  underlying: 'BTC',
  expiry: '2026-03-27',
  strike: 70_000,
  quantity: 1,
  preferredVenues: ['deribit'],
} as const;

describe('PaperOrderLegSchema', () => {
  it('round-trips a valid leg unchanged', () => {
    const result = PaperOrderLegSchema.safeParse(validLeg);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(validLeg);
  });

  it('accepts a null preferredVenues', () => {
    expect(PaperOrderLegSchema.safeParse({ ...validLeg, preferredVenues: null }).success).toBe(true);
  });

  it('rejects a non-YYYY-MM-DD expiry', () => {
    expect(PaperOrderLegSchema.safeParse({ ...validLeg, expiry: '27MAR26' }).success).toBe(false);
  });

  it('rejects a non-positive strike', () => {
    expect(PaperOrderLegSchema.safeParse({ ...validLeg, strike: 0 }).success).toBe(false);
  });

  it('rejects a non-positive quantity', () => {
    expect(PaperOrderLegSchema.safeParse({ ...validLeg, quantity: -1 }).success).toBe(false);
  });

  it('rejects an unknown venue in preferredVenues', () => {
    expect(PaperOrderLegSchema.safeParse({ ...validLeg, preferredVenues: ['kraken'] }).success).toBe(
      false,
    );
  });
});

describe('PlaceOrderRequestSchema', () => {
  const orderLeg = {
    side: 'sell',
    optionRight: 'put',
    underlying: 'ETH',
    expiry: '2026-06-26',
    strike: 3_000,
    quantity: 2,
  };

  it('defaults venueFilter to an empty array when omitted', () => {
    const result = PlaceOrderRequestSchema.safeParse({ legs: [orderLeg] });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.venueFilter).toEqual([]);
  });

  it('rejects an empty legs array', () => {
    expect(PlaceOrderRequestSchema.safeParse({ legs: [] }).success).toBe(false);
  });

  it('strips an unexpected index key from an order leg', () => {
    // index is omit()'d on the order leg; Zod drops unknown keys by default,
    // so an accidentally-supplied index is silently removed rather than rejected.
    const result = PlaceOrderRequestSchema.safeParse({ legs: [{ ...orderLeg, index: 5 }] });
    expect(result.success).toBe(true);
    if (result.success) expect('index' in result.data.legs[0]!).toBe(false);
  });
});

describe('CreatePaperTradeRequestSchema', () => {
  const order = { legs: [{ side: 'buy', optionRight: 'call', underlying: 'BTC', expiry: '2026-03-27', strike: 70_000, quantity: 1 }] };

  it('accepts a minimal request (order only)', () => {
    expect(CreatePaperTradeRequestSchema.safeParse({ order }).success).toBe(true);
  });

  it('rejects a thesis over the 2000-char limit', () => {
    expect(
      CreatePaperTradeRequestSchema.safeParse({ order, thesis: 'x'.repeat(2_001) }).success,
    ).toBe(false);
  });
});

describe('CreatePaperTradeNoteRequestSchema', () => {
  it('defaults tags to an empty array', () => {
    const result = CreatePaperTradeNoteRequestSchema.safeParse({ kind: 'thesis', content: 'hi' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.tags).toEqual([]);
  });

  it('rejects more than 12 tags', () => {
    const tags = Array.from({ length: 13 }, (_, i) => `t${i}`);
    expect(CreatePaperTradeNoteRequestSchema.safeParse({ kind: 'note', content: 'x', tags }).success).toBe(
      false,
    );
  });

  it('rejects an unknown note kind', () => {
    expect(CreatePaperTradeNoteRequestSchema.safeParse({ kind: 'rumor', content: 'x' }).success).toBe(
      false,
    );
  });
});

describe('ReducePaperTradeRequestSchema', () => {
  it('accepts a fraction in (0, 1]', () => {
    expect(ReducePaperTradeRequestSchema.safeParse({ fraction: 0.5 }).success).toBe(true);
    expect(ReducePaperTradeRequestSchema.safeParse({ fraction: 1 }).success).toBe(true);
  });

  it('rejects a fraction of 0 or above 1', () => {
    expect(ReducePaperTradeRequestSchema.safeParse({ fraction: 0 }).success).toBe(false);
    expect(ReducePaperTradeRequestSchema.safeParse({ fraction: 1.5 }).success).toBe(false);
  });
});

describe('InitPaperAccountRequestSchema', () => {
  it('accepts a $1000-multiple within bounds', () => {
    expect(InitPaperAccountRequestSchema.safeParse({ initialCashUsd: 50_000 }).success).toBe(true);
  });

  it('rejects an amount that is not a multiple of 1000', () => {
    expect(InitPaperAccountRequestSchema.safeParse({ initialCashUsd: 1_500 }).success).toBe(false);
  });

  it('rejects amounts below the floor or above the ceiling', () => {
    expect(InitPaperAccountRequestSchema.safeParse({ initialCashUsd: 500 }).success).toBe(false);
    expect(InitPaperAccountRequestSchema.safeParse({ initialCashUsd: 200_000 }).success).toBe(false);
  });
});
