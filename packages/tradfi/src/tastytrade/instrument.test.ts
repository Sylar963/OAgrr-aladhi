import { describe, expect, it } from 'vitest';
import { buildCanonical, nestedChainToInstruments, tickFor } from './instrument.js';

describe('instrument', () => {
  it('builds the canonical symbol', () => {
    expect(buildCanonical('AAPL', '2026-04-17', 200, 'call')).toBe('AAPL/USD:USD-260417-200-C');
    expect(buildCanonical('SPX', '2026-06-20', 5000, 'put')).toBe('SPX/USD:USD-260620-5000-P');
  });

  it('renders fractional strikes in the canonical symbol', () => {
    expect(buildCanonical('SPX', '2026-06-20', 5002.5, 'call')).toBe('SPX/USD:USD-260620-5002.5-C');
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

  it('times expiry at the 16:00 ET close across DST', () => {
    const ts = (date: string) =>
      nestedChainToInstruments({
        items: [{
          'underlying-symbol': 'SPX',
          'root-symbol': 'SPXW',
          expirations: [{
            'expiration-date': date,
            'settlement-type': 'PM',
            strikes: [{ 'strike-price': '5000', call: 'SPXW C', 'call-streamer-symbol': '.SPXWC' }],
          }],
        }],
      })[0]!.expiryTs;
    expect(ts('2026-04-17')).toBe(Date.parse('2026-04-17T20:00:00Z'));
    expect(ts('2026-12-18')).toBe(Date.parse('2026-12-18T21:00:00Z'));
  });

  it('drops AM-settled expirations and keeps the PM root on the same date', () => {
    const strike = (root: string) => [{
      'strike-price': '5000',
      call: `${root} C`,
      'call-streamer-symbol': `.${root}C`,
    }];
    const insts = nestedChainToInstruments({
      items: [
        {
          'underlying-symbol': 'SPX',
          'root-symbol': 'SPX',
          expirations: [{ 'expiration-date': '2026-10-16', 'settlement-type': 'AM', strikes: strike('SPX') }],
        },
        {
          'underlying-symbol': 'SPX',
          'root-symbol': 'SPXW',
          expirations: [{ 'expiration-date': '2026-10-16', 'settlement-type': 'PM', strikes: strike('SPXW') }],
        },
      ],
    });
    expect(insts).toHaveLength(1);
    expect(insts[0]!.rootSymbol).toBe('SPXW');
    expect(insts[0]!.expiryTs).toBe(Date.parse('2026-10-16T20:00:00Z'));
  });

  it('parses the tick ladder and picks the tick for a premium', () => {
    const [inst] = nestedChainToInstruments({
      items: [{
        'underlying-symbol': 'SPX',
        'tick-sizes': [{ threshold: '3.0', value: '0.05' }, { value: '0.1' }],
        expirations: [{
          'expiration-date': '2026-04-17',
          strikes: [{ 'strike-price': '5000', call: 'SPX C', 'call-streamer-symbol': '.SPXC' }],
        }],
      }],
    });
    expect(inst!.tickSizes).toEqual([{ below: 3, value: 0.05 }, { below: null, value: 0.1 }]);
    expect(tickFor(inst!.tickSizes, 2.95)).toBe(0.05);
    expect(tickFor(inst!.tickSizes, 3)).toBe(0.1);
    expect(tickFor(inst!.tickSizes, null)).toBe(0.05);
    expect(tickFor([], 1)).toBeNull();
  });
});
