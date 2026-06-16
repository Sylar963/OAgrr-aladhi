import { DEFAULT_TAB } from '@lib/tabs';
import { describe, expect, it } from 'vitest';
import { buildHash, parseHash, type RouteState } from './route-hash';

describe('parseHash', () => {
  it('parses a crypto tab + ticker', () => {
    expect(parseHash('#chain/BTC')).toEqual({ mode: 'crypto', tab: 'chain', ticker: 'BTC' });
    expect(parseHash('#volatility/ETH')).toEqual({
      mode: 'crypto',
      tab: 'surface',
      ticker: 'ETH',
    });
  });

  it('uppercases the ticker', () => {
    expect(parseHash('#chain/btc')).toEqual({ mode: 'crypto', tab: 'chain', ticker: 'BTC' });
  });

  it('back-compat: crypto tab with no ticker', () => {
    expect(parseHash('#chain')).toEqual({ mode: 'crypto', tab: 'chain', ticker: null });
  });

  it('unknown crypto slug falls back to the default tab with no ticker', () => {
    expect(parseHash('#nope')).toEqual({ mode: 'crypto', tab: DEFAULT_TAB, ticker: null });
  });

  it('parses a tradfi page + ticker', () => {
    expect(parseHash('#tradfi/gex/AAPL')).toEqual({ mode: 'tradfi', page: 'gex', ticker: 'AAPL' });
    expect(parseHash('#tradfi/chain/TSLA')).toEqual({
      mode: 'tradfi',
      page: 'chain',
      ticker: 'TSLA',
    });
  });

  it('back-compat: bare #tradfi → chain page, no ticker', () => {
    expect(parseHash('#tradfi')).toEqual({ mode: 'tradfi', page: 'chain', ticker: null });
  });

  it('tradfi with the page omitted treats the segment as a ticker', () => {
    expect(parseHash('#tradfi/AAPL')).toEqual({ mode: 'tradfi', page: 'chain', ticker: 'AAPL' });
  });

  it('tolerates a missing leading # and empty input', () => {
    expect(parseHash('chain/BTC')).toEqual({ mode: 'crypto', tab: 'chain', ticker: 'BTC' });
    expect(parseHash('')).toEqual({ mode: 'crypto', tab: DEFAULT_TAB, ticker: null });
    expect(parseHash('#')).toEqual({ mode: 'crypto', tab: DEFAULT_TAB, ticker: null });
  });
});

describe('buildHash', () => {
  it('builds crypto hashes with the tab slug + uppercased ticker', () => {
    expect(buildHash({ mode: 'crypto', tab: 'chain', ticker: 'BTC' })).toBe('#chain/BTC');
    expect(buildHash({ mode: 'crypto', tab: 'surface', ticker: 'eth' })).toBe('#volatility/ETH');
  });

  it('omits the ticker segment when ticker is null/empty', () => {
    expect(buildHash({ mode: 'crypto', tab: 'chain', ticker: null })).toBe('#chain');
    expect(buildHash({ mode: 'tradfi', page: 'chain', ticker: null })).toBe('#tradfi/chain');
  });

  it('builds tradfi hashes with page + ticker', () => {
    expect(buildHash({ mode: 'tradfi', page: 'gex', ticker: 'AAPL' })).toBe('#tradfi/gex/AAPL');
  });
});

describe('round-trip', () => {
  it('buildHash → parseHash is stable', () => {
    const states: RouteState[] = [
      { mode: 'crypto', tab: 'chain', ticker: 'BTC' },
      { mode: 'crypto', tab: 'surface', ticker: 'ETH' },
      { mode: 'crypto', tab: 'gex', ticker: null },
      { mode: 'tradfi', page: 'chain', ticker: 'AAPL' },
      { mode: 'tradfi', page: 'gex', ticker: null },
    ];
    for (const state of states) {
      expect(parseHash(buildHash(state))).toEqual(state);
    }
  });
});
