import { describe, expect, it } from 'vitest';
import { chainSubscriptions, underlyingSubscriptions } from './planner.js';

describe('planner', () => {
  it('expands streamer symbols into 4 event subs each', () => {
    const subs = chainSubscriptions(['.AAPL200C', '.AAPL200P']);
    expect(subs).toHaveLength(8);
    expect(subs.filter((s) => s.symbol === '.AAPL200C').map((s) => s.type).sort())
      .toEqual(['Greeks', 'Quote', 'Summary', 'Trade']);
  });

  it('subscribes underlyings to Quote+Trade', () => {
    const subs = underlyingSubscriptions(['AAPL']);
    expect(subs.map((s) => s.type).sort()).toEqual(['Quote', 'Trade']);
  });
});
