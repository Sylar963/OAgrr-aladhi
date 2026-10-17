import { describe, expect, it } from 'vitest';
import { parseParadexSummariesWhere } from './codec.js';
import { ParadexSummaryResponseSchema } from './types.js';

const summary = (symbol: string, mark = '455.43645183') => ({
  symbol,
  mark_price: mark,
  mark_iv: '0.49969521',
  greeks: { delta: '0.24458572', gamma: '0.00009747', vega: '20.25', theta: '-134.69', rho: '-0.0467' },
  last_traded_price: '',
  bid: '320',
  bid_size: '0.033',
  ask: '480',
  ask_size: '0.033',
  volume_24h: '0',
  created_at: 1780927581396,
  underlying_price: '63653.90898322',
  open_interest: '0',
  funding_rate: '',
});

describe('parseParadexSummariesWhere', () => {
  const payload = {
    results: [
      summary('BTC-USD-12JUN26-66000-C'),
      summary('ETH-USD-12JUN26-3000-P'),
      summary('BTC-USD-PERP'),
      summary('BTC-USD-12JUN26-70000-C', '512.1'),
    ],
  };
  const btcOptions = (symbol: string) => symbol.startsWith('BTC-') && symbol.split('-').length === 5;

  it('returns exactly what the full schema returns for the accepted symbols', () => {
    const full = ParadexSummaryResponseSchema.parse(payload).results.filter((s) => btcOptions(s.symbol));
    expect(parseParadexSummariesWhere(payload, btcOptions)).toEqual(full);
  });

  it('skips a malformed element instead of discarding the whole list', () => {
    const withBad = { results: [...payload.results, { ...summary('BTC-USD-12JUN26-1-C'), mark_price: 7 }] };
    expect(parseParadexSummariesWhere(withBad, btcOptions).map((s) => s.symbol)).toEqual([
      'BTC-USD-12JUN26-66000-C',
      'BTC-USD-12JUN26-70000-C',
    ]);
  });

  it('never validates rejected elements and tolerates a malformed envelope', () => {
    const seen: string[] = [];
    parseParadexSummariesWhere(
      { results: [summary('A'), null, 5, { symbol: 3 }, summary('B')] },
      (symbol) => {
        seen.push(symbol);
        return false;
      },
    );
    expect(seen).toEqual(['A', 'B']);
    expect(parseParadexSummariesWhere(null, () => true)).toEqual([]);
    expect(parseParadexSummariesWhere({ results: 'x' }, () => true)).toEqual([]);
  });
});
