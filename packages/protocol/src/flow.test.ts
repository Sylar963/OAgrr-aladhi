import { describe, expect, it } from 'vitest';

import { InstrumentTradeWsServerMessageSchema } from './flow.js';

const trade = {
  venue: 'deribit',
  tradeUid: 'deribit:BTC-27MAR26-70000-C:1',
  tradeId: '1',
  instrument: 'BTC-27MAR26-70000-C',
  underlying: 'BTC',
  side: 'buy',
  price: 0.01,
  size: 1,
  iv: 0.5,
  markPrice: 0.01,
  indexPrice: 70_000,
  premiumUsd: 700,
  notionalUsd: 70_000,
  referencePriceUsd: 70_000,
  isBlock: false,
  timestamp: 1_700_000_000_000,
};

describe('InstrumentTradeWsServerMessageSchema', () => {
  it('accepts a flow trade snapshot', () => {
    const result = InstrumentTradeWsServerMessageSchema.safeParse({
      type: 'snapshot',
      generatedAt: 1_700_000_000_100,
      trades: [trade],
    });

    expect(result.success).toBe(true);
  });

  it('rejects an unknown venue', () => {
    const result = InstrumentTradeWsServerMessageSchema.safeParse({
      type: 'trade',
      trade: { ...trade, venue: 'unknown' },
    });

    expect(result.success).toBe(false);
  });
});
