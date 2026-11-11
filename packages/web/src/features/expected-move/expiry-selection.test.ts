import { describe, expect, it } from 'vitest';
import { selectExpectedMoveExpiries } from './expiry-selection';

const now = Date.parse('2026-11-11T17:30:00Z');

describe('Expected Move expiry selection', () => {
  it('skips yesterday and rolls forward at the exact settlement time', () => {
    const data = {
      expiries: ['2026-11-10', '2026-11-11', '2026-11-12'],
      timestamps: [
        { expiry: '2026-11-10', expiryTs: Date.parse('2026-11-10T21:00:00Z') },
        { expiry: '2026-11-11', expiryTs: Date.parse('2026-11-11T21:00:00Z') },
        { expiry: '2026-11-12', expiryTs: Date.parse('2026-11-12T21:00:00Z') },
      ],
    };
    expect(selectExpectedMoveExpiries(data, 'SPX', 'tastytrade', now)).toEqual([
      '2026-11-11',
      '2026-11-12',
    ]);
    expect(
      selectExpectedMoveExpiries(data, 'SPX', 'tastytrade', Date.parse('2026-11-11T21:00:00Z')),
    ).toEqual(['2026-11-12']);
  });

  it('uses the selected venue settlement rather than another venue on the same date', () => {
    const expiry = '2026-11-11';
    const data = {
      expiries: [expiry],
      timestamps: [{ expiry, expiryTs: now - 1 }],
      byVenue: [
        { venue: 'deribit', expiries: [expiry], timestamps: [{ expiry, expiryTs: now - 1 }] },
        { venue: 'thalex', expiries: [expiry], timestamps: [{ expiry, expiryTs: now + 1 }] },
      ],
    };
    expect(selectExpectedMoveExpiries(data, 'BTC', 'deribit', now)).toEqual([]);
    expect(selectExpectedMoveExpiries(data, 'BTC', 'thalex', now)).toEqual([expiry]);
    expect(selectExpectedMoveExpiries(data, 'BTC', 'bybit', now)).toEqual([]);
  });

  it('retains compatibility without timestamps and respects the market calendar date', () => {
    const midnight = Date.parse('2026-11-12T01:00:00Z');
    const expiries = ['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-12'];
    expect(selectExpectedMoveExpiries({ expiries }, 'SPX', 'tastytrade', midnight)).toEqual([
      '2026-11-11',
      '2026-11-12',
    ]);
    expect(
      selectExpectedMoveExpiries(
        { expiries, byVenue: [{ venue: 'deribit', expiries }] },
        'BTC',
        'deribit',
        midnight,
      ),
    ).toEqual(['2026-11-12']);
  });
});
