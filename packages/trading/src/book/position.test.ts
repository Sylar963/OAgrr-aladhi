import { describe, expect, it } from 'vitest';
import type { Fill } from './fill.js';
import { applyFillToPosition, type Position } from './position.js';

function makeFill(partial: Partial<Fill> & Pick<Fill, 'side' | 'quantity' | 'priceUsd'>): Fill {
  return {
    id: 'fil_x',
    orderId: 'ord_x',
    legIndex: 0,
    venue: 'deribit',
    optionRight: 'call',
    underlying: 'BTC',
    expiry: '2026-06-26',
    strike: 70000,
    feesUsd: 0,
    source: 'paper',
    filledAt: new Date('2026-04-17T00:00:00Z'),
    ...partial,
  };
}

describe('applyFillToPosition', () => {
  it('opens a new long position from a buy fill', () => {
    const next = applyFillToPosition(
      null,
      makeFill({ side: 'buy', quantity: 2, priceUsd: 1000 }),
    );
    expect(next.netQuantity).toBe(2);
    expect(next.avgEntryPriceUsd).toBe(1000);
    expect(next.realizedPnlUsd).toBe(0);
  });

  it('opens a new short position from a sell fill', () => {
    const next = applyFillToPosition(
      null,
      makeFill({ side: 'sell', quantity: 3, priceUsd: 500 }),
    );
    expect(next.netQuantity).toBe(-3);
    expect(next.avgEntryPriceUsd).toBe(500);
  });

  it('averages entry when adding to a long', () => {
    const first = applyFillToPosition(
      null,
      makeFill({ side: 'buy', quantity: 2, priceUsd: 1000 }),
    );
    const second = applyFillToPosition(
      first,
      makeFill({ side: 'buy', quantity: 2, priceUsd: 1500 }),
    );
    expect(second.netQuantity).toBe(4);
    expect(second.avgEntryPriceUsd).toBe(1250);
    expect(second.realizedPnlUsd).toBe(0);
  });

  it('realizes PnL on partial close of a long', () => {
    const open = applyFillToPosition(
      null,
      makeFill({ side: 'buy', quantity: 4, priceUsd: 1000 }),
    );
    const close = applyFillToPosition(
      open,
      makeFill({ side: 'sell', quantity: 1, priceUsd: 1200 }),
    );
    expect(close.netQuantity).toBe(3);
    expect(close.avgEntryPriceUsd).toBe(1000);
    expect(close.realizedPnlUsd).toBe(200);
  });

  it('realizes PnL on full close', () => {
    const open = applyFillToPosition(
      null,
      makeFill({ side: 'buy', quantity: 2, priceUsd: 1000 }),
    );
    const close = applyFillToPosition(
      open,
      makeFill({ side: 'sell', quantity: 2, priceUsd: 1500 }),
    );
    expect(close.netQuantity).toBe(0);
    expect(close.realizedPnlUsd).toBe(1000);
  });

  it('flips from long to short and resets avg entry', () => {
    const open = applyFillToPosition(
      null,
      makeFill({ side: 'buy', quantity: 2, priceUsd: 1000 }),
    );
    const flip = applyFillToPosition(
      open,
      makeFill({ side: 'sell', quantity: 5, priceUsd: 1200 }),
    );
    expect(flip.netQuantity).toBe(-3);
    expect(flip.avgEntryPriceUsd).toBe(1200);
    expect(flip.realizedPnlUsd).toBe(400);
  });

  it('realizes PnL on partial close of a short', () => {
    const open = applyFillToPosition(
      null,
      makeFill({ side: 'sell', quantity: 4, priceUsd: 1200 }),
    );
    const close = applyFillToPosition(
      open,
      makeFill({ side: 'buy', quantity: 1, priceUsd: 800 }),
    );
    expect(close.netQuantity).toBe(-3);
    expect(close.avgEntryPriceUsd).toBe(1200);
    expect(close.realizedPnlUsd).toBe(400);
  });
});
