import { describe, expect, it } from 'vitest';
import { input, now } from './spread-scan.fixtures';
import { defaultQuantity, suggestVenueQuantity, venueSizeRule } from './venue-sizing';

function thinBookChain(displayed: number, minNotionalUsd: number) {
  const { chain } = input();
  for (const strike of chain.strikes) {
    for (const side of [strike.call, strike.put]) {
      const venueQuote = side.venues.thalex!;
      venueQuote.execution = {
        ...venueQuote.execution!,
        bidSize: displayed,
        askSize: displayed,
        minNotionalUsd,
      };
    }
  }
  return chain;
}

describe('defaultQuantity', () => {
  it('sizes about $100 of notional on the venue step, never below the minimum', () => {
    expect(defaultQuantity({ min: 0.01, step: 0.01 }, 105)).toBe(0.96);
    expect(defaultQuantity({ min: 10, step: 10 }, 105)).toBe(10);
    expect(defaultQuantity({ min: 100, step: 100 }, 0.08)).toBe(1300);
    expect(defaultQuantity({ min: 0.01, step: 0.01 }, 81_000)).toBe(0.01);
    expect(defaultQuantity({ min: 1, step: 1 }, null)).toBe(1);
  });
});

describe('suggestVenueQuantity', () => {
  it('finds the size window between an order-value floor and displayed depth', () => {
    // $15 per leg at mark rejects 0.01–0.02 BTC on the $650 wing; 0.07 BTC exceeds 0.05 displayed.
    const suggestion = suggestVenueQuantity(thinBookChain(0.05, 15), 'thalex', 0.25, now);
    expect(suggestion?.quantity).toBe(0.04);
    expect(suggestion?.pairs).toBeGreaterThan(0);
  });

  it('prefers the smallest size when every rung prices the same pairs', () => {
    const suggestion = suggestVenueQuantity(thinBookChain(10, 0), 'thalex', 0.25, now);
    expect(suggestion?.quantity).toBe(venueSizeRule(input().chain, 'thalex')!.min);
  });

  it('falls back to the $100 default when no size prices a pair', () => {
    const suggestion = suggestVenueQuantity(thinBookChain(0.001, 0), 'thalex', 0.25, now);
    expect(suggestion).toEqual({ quantity: 0.01, pairs: 0 });
  });

  it('has no suggestion for a venue without execution data on the chain', () => {
    expect(suggestVenueQuantity(input().chain, 'deribit', 0.25, now)).toBeNull();
  });
});
