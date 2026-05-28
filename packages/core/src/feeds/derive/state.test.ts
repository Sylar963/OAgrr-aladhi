/**
 * buildDeriveQuote — zero-quote handling.
 *
 * Derive sends "0" (not null) for an inactive quote side, and each ticker is a
 * full snapshot that replaces the stored quote. Quote-side fields must therefore
 * normalize "0" to null so a contract with no market reads as empty downstream
 * (enrichment gates on bid/ask > 0) rather than as a phantom $0 market.
 *
 * Fixture mirrors the "zero-market" example in types.test.ts (ws-get-tickers.md).
 */

import { describe, it, expect } from 'vitest';
import { BaseAdapter } from '../shared/base.js';
import type { VenueCapabilities } from '../shared/types.js';
import type { VenueId } from '../../types/common.js';
import { buildDeriveQuote } from './state.js';
import { DeriveTickerSchema } from './types.js';

class TestAdapter extends BaseAdapter {
  readonly venue: VenueId = 'derive';
  readonly capabilities: VenueCapabilities = { optionChain: true, greeks: true, websocket: true };

  async loadMarkets(): Promise<void> {}
  async listUnderlyings(): Promise<string[]> {
    return [];
  }
  async listExpiries(): Promise<string[]> {
    return [];
  }
  async fetchOptionChain(): Promise<never> {
    throw new Error('not implemented');
  }

  public num(value: unknown): number | null {
    return this.safeNum(value);
  }
  public pos(value: unknown): number | null {
    return this.positiveOrNull(value);
  }
}

const adapter = new TestAdapter();
const build = (ticker: ReturnType<typeof DeriveTickerSchema.parse>) =>
  buildDeriveQuote(
    ticker,
    (value) => adapter.num(value),
    (value) => adapter.pos(value),
  );

const ZERO_MARKET = {
  t: 1773963675269,
  A: '0',
  a: '0',
  B: '0',
  b: '0',
  f: null,
  option_pricing: {
    d: '-0.99999',
    t: '0',
    g: '0',
    v: '0',
    i: '0.70527',
    r: '1716.27839',
    f: '69727',
    m: '85272',
    df: '1',
    bi: '0',
    ai: '0',
  },
  I: '69739',
  M: '85272',
  stats: { c: '0', v: '0', pr: '0', n: 0, oi: '0', h: '0', l: '0', p: '0' },
  minp: '82263',
  maxp: '87954',
};

describe('buildDeriveQuote', () => {
  it('nulls "0" quote sides while keeping mark/greeks', () => {
    const quote = build(DeriveTickerSchema.parse(ZERO_MARKET));

    expect(quote.bidPrice).toBeNull();
    expect(quote.askPrice).toBeNull();
    expect(quote.bidSize).toBeNull();
    expect(quote.askSize).toBeNull();
    expect(quote.greeks.bidIv).toBeNull();
    expect(quote.greeks.askIv).toBeNull();

    // Model-derived fields are unaffected.
    expect(quote.greeks.markIv).toBeCloseTo(0.70527);
    expect(quote.greeks.delta).toBeCloseTo(-0.99999);
  });

  it('passes genuine quotes through unchanged', () => {
    const quote = build(
      DeriveTickerSchema.parse({
        ...ZERO_MARKET,
        b: '100.5',
        a: '120.25',
        B: '2.5',
        A: '1.75',
        option_pricing: { ...ZERO_MARKET.option_pricing, bi: '0.65', ai: '0.72' },
      }),
    );

    expect(quote.bidPrice).toBe(100.5);
    expect(quote.askPrice).toBe(120.25);
    expect(quote.bidSize).toBe(2.5);
    expect(quote.askSize).toBe(1.75);
    expect(quote.greeks.bidIv).toBeCloseTo(0.65);
    expect(quote.greeks.askIv).toBeCloseTo(0.72);
  });
});
