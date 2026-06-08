import { describe, expect, it } from 'vitest';
import { PARADEX_SUMMARY_CHANNEL, isParadexOptionSymbol } from './planner.js';

describe('paradex planner', () => {
  it('uses the bare markets_summary firehose channel', () => {
    expect(PARADEX_SUMMARY_CHANNEL).toBe('markets_summary');
  });

  it('identifies option symbols, excludes perps/spot', () => {
    expect(isParadexOptionSymbol('BTC-USD-12JUN26-66000-C')).toBe(true);
    expect(isParadexOptionSymbol('ETH-USD-26JUN26-3000-P')).toBe(true);
    expect(isParadexOptionSymbol('BTC-USD-PERP')).toBe(false);
    expect(isParadexOptionSymbol('ETH-USD')).toBe(false);
  });
});
