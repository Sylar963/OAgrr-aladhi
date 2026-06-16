import { describe, it, expect } from 'vitest';
import { VENUES, VENUE_IDS } from './venue-meta';

describe('venue-meta', () => {
  it('exposes tastytrade metadata with a logo (for the TradFi venue badge)', () => {
    expect(VENUES.tastytrade).toBeTruthy();
    expect(VENUES.tastytrade!.logo).toBeTruthy();
    expect(VENUES.tastytrade!.label).toBe('tastytrade');
  });

  // Guard the subtlety: tastytrade is metadata-only. If it leaks into the crypto
  // enumeration it pollutes default active venues, surface queries, and the picker.
  it('keeps tastytrade OUT of the crypto venue enumeration', () => {
    expect(VENUE_IDS).not.toContain('tastytrade');
    expect(VENUE_IDS).toContain('deribit');
  });
});
