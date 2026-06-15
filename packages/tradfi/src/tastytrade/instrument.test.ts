import { describe, expect, it } from 'vitest';
import { buildCanonical, nestedChainToInstruments } from './instrument.js';

describe('instrument', () => {
  it('builds the canonical symbol', () => {
    expect(buildCanonical('AAPL', '2026-04-17', 200, 'call')).toBe('AAPL/USD:USD-260417-200-C');
    expect(buildCanonical('SPX', '2026-06-20', 5000, 'put')).toBe('SPX/USD:USD-260620-5000-P');
  });

  it('flattens a nested chain into call+put instruments', () => {
    const data = {
      items: [{
        'underlying-symbol': 'AAPL',
        'root-symbol': 'AAPL',
        'shares-per-contract': 100,
        expirations: [{
          'expiration-date': '2026-04-17',
          'settlement-type': 'Physical',
          'expiration-type': 'Regular',
          strikes: [{
            'strike-price': '200.0',
            call: 'AAPL  260417C00200000',
            put: 'AAPL  260417P00200000',
            'call-streamer-symbol': '.AAPL260417C200',
            'put-streamer-symbol': '.AAPL260417P200',
          }],
        }],
      }],
    };
    const insts = nestedChainToInstruments(data);
    expect(insts).toHaveLength(2);
    const call = insts.find((i) => i.right === 'call')!;
    expect(call.underlying).toBe('AAPL');
    expect(call.expiry).toBe('2026-04-17');
    expect(call.strike).toBe(200);
    expect(call.streamerSymbol).toBe('.AAPL260417C200');
    expect(call.canonical).toBe('AAPL/USD:USD-260417-200-C');
    expect(call.multiplier).toBe(100);
    expect(call.settlementType).toBe('physical'); // 'Physical' -> 'physical'
  });

  it('skips strikes missing a streamer symbol', () => {
    const data = {
      items: [{
        'underlying-symbol': 'AAPL', expirations: [{
          'expiration-date': '2026-04-17',
          strikes: [{ 'strike-price': '200.0' }],
        }],
      }],
    };
    expect(nestedChainToInstruments(data)).toHaveLength(0);
  });
});
