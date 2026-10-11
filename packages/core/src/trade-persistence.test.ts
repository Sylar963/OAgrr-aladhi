import { describe, expect, it } from 'vitest';

import type { TradeEvent } from './runtime/trades/types.js';
import { computeLiveTradeAmounts, getVenueContractMultiplier } from './trade-persistence.js';

function trade(overrides: Partial<TradeEvent>): TradeEvent {
  return {
    venue: 'gateio',
    tradeId: 'BTC_USDT-20261016-82000-C:5',
    instrument: 'BTC_USDT-20261016-82000-C',
    underlying: 'BTC',
    side: 'buy',
    price: 2186,
    size: 25,
    iv: null,
    markPrice: null,
    indexPrice: null,
    isBlock: false,
    timestamp: 1_791_751_003_000,
    ...overrides,
  };
}

describe('getVenueContractMultiplier', () => {
  it('uses Gate.io contract multipliers per underlying', () => {
    expect(getVenueContractMultiplier('gateio', 'BTC')).toBe(0.01);
    expect(getVenueContractMultiplier('gateio', 'eth')).toBe(0.01);
    expect(getVenueContractMultiplier('gateio', 'DOGE')).toBe(1000);
    expect(getVenueContractMultiplier('gateio', 'XTI')).toBe(1);
  });

  it('keeps OKX multipliers and leaves 1-unit venues alone', () => {
    expect(getVenueContractMultiplier('okx', 'BTC')).toBe(0.01);
    expect(getVenueContractMultiplier('okx', 'ETH')).toBe(0.1);
    expect(getVenueContractMultiplier('deribit', 'BTC')).toBe(1);
    expect(getVenueContractMultiplier('bybit', 'BTC')).toBe(1);
  });
});

describe('computeLiveTradeAmounts', () => {
  it('scales Gate.io contract counts into underlying units', () => {
    const amounts = computeLiveTradeAmounts(trade({}), 83_600);
    expect(amounts.contracts).toBeCloseTo(0.25);
    expect(amounts.premiumUsd).toBeCloseTo(546.5);
    expect(amounts.notionalUsd).toBeCloseTo(20_900);
  });

  it('keeps linear Gate.io premium when no reference price is known', () => {
    const amounts = computeLiveTradeAmounts(trade({}), null);
    expect(amounts.premiumUsd).toBeCloseTo(546.5);
    expect(amounts.notionalUsd).toBeNull();
  });
});
