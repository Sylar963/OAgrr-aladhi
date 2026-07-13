import type { FlowTrade } from '@oggregator/protocol';
import { describe, expect, it } from 'vitest';

import { mergeInstrumentTrades } from './use-instrument-trades-live';

function trade(tradeUid: string, timestamp: number, price = 1): FlowTrade {
  return {
    venue: 'deribit',
    tradeUid,
    tradeId: tradeUid,
    instrument: 'BTC-27MAR26-70000-C',
    underlying: 'BTC',
    side: 'buy',
    price,
    size: 1,
    iv: 0.5,
    markPrice: 1,
    indexPrice: 70_000,
    premiumUsd: 70_000,
    notionalUsd: 70_000,
    referencePriceUsd: 70_000,
    isBlock: false,
    timestamp,
  };
}

describe('mergeInstrumentTrades', () => {
  it('deduplicates overlap while preferring persisted history values', () => {
    const history = [trade('same', 100, 2)];
    const live = [trade('same', 100, 1), trade('new', 200, 3)];

    const merged = mergeInstrumentTrades(history, live);

    expect(merged.map((row) => row.tradeUid)).toEqual(['new', 'same']);
    expect(merged[1]?.price).toBe(2);
  });

  it('limits the newest merged trades', () => {
    const merged = mergeInstrumentTrades([], [trade('old', 100), trade('new', 200)], 1);

    expect(merged.map((row) => row.tradeUid)).toEqual(['new']);
  });
});
