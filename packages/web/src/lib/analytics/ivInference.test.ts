import { describe, it, expect } from 'vitest';

import type { VenueQuote } from '@shared/enriched';
import { black76Price } from './blackScholes';
import { inferMissingIv } from './ivInference';

const BASE_QUOTE: VenueQuote = {
  bid: null,
  ask: null,
  mid: null,
  midRaw: null,
  bidSize: null,
  askSize: null,
  markIv: null,
  bidIv: null,
  askIv: null,
  delta: null,
  gamma: null,
  theta: null,
  vega: null,
  spreadPct: null,
  totalCost: null,
  estimatedFees: null,
  openInterest: null,
  volume24h: null,
  openInterestUsd: null,
  volume24hUsd: null,
};

describe('inferMissingIv', () => {
  it('round-trips σ=0.3 from bid/ask prices (call)', () => {
    const forward = 102;
    const strike = 95;
    const T = 0.25;
    const priceAtSigma = (sigma: number) => black76Price('call', forward, strike, T, sigma);
    const quote: VenueQuote = {
      ...BASE_QUOTE,
      bid: priceAtSigma(0.3),
      ask: priceAtSigma(0.32),
      mid: priceAtSigma(0.31),
    };

    const patched = inferMissingIv(quote, { forward, strike, T, right: 'call' });

    expect(patched.bidIv).not.toBeNull();
    expect(patched.askIv).not.toBeNull();
    expect(patched.markIv).not.toBeNull();
    expect(patched.bidIv!).toBeCloseTo(0.3, 4);
    expect(patched.askIv!).toBeCloseTo(0.32, 4);
    expect(patched.markIv!).toBeCloseTo(0.31, 4);
  });

  it('round-trips σ=0.45 from bid/ask prices (put)', () => {
    const forward = 98;
    const strike = 105;
    const T = 0.5;
    const bid = black76Price('put', forward, strike, T, 0.45);
    const ask = black76Price('put', forward, strike, T, 0.47);
    const quote: VenueQuote = {
      ...BASE_QUOTE,
      bid,
      ask,
      mid: (bid + ask) / 2,
    };

    const patched = inferMissingIv(quote, { forward, strike, T, right: 'put' });

    expect(patched.bidIv!).toBeCloseTo(0.45, 4);
    expect(patched.askIv!).toBeCloseTo(0.47, 4);
  });

  it('preserves existing IV fields (does not overwrite)', () => {
    const quote: VenueQuote = {
      ...BASE_QUOTE,
      bid: 1.23,
      ask: 1.45,
      mid: 1.34,
      bidIv: 0.5,
      askIv: 0.55,
      markIv: 0.52,
    };
    const patched = inferMissingIv(quote, {
      forward: 100,
      strike: 100,
      T: 1,
      right: 'call',
    });
    expect(patched.bidIv).toBe(0.5);
    expect(patched.askIv).toBe(0.55);
    expect(patched.markIv).toBe(0.52);
  });

  it('leaves IV null when the corresponding price is null or zero', () => {
    const quote: VenueQuote = { ...BASE_QUOTE, bid: 0, ask: null, mid: null };
    const patched = inferMissingIv(quote, {
      forward: 100,
      strike: 100,
      T: 1,
      right: 'call',
    });
    expect(patched.bidIv).toBeNull();
    expect(patched.askIv).toBeNull();
    expect(patched.markIv).toBeNull();
  });

  it('does not mutate the input quote', () => {
    const quote: VenueQuote = { ...BASE_QUOTE, bid: 5, mid: 5 };
    const patched = inferMissingIv(quote, {
      forward: 100,
      strike: 100,
      T: 1,
      right: 'call',
    });
    expect(quote.bidIv).toBeNull();
    expect(quote.markIv).toBeNull();
    expect(patched).not.toBe(quote);
  });
});
