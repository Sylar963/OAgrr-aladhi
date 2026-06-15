import { describe, it, expect } from 'vitest';
import { VENUE_IDS } from './ws.js';
import {
  VenueCredentialsSchema,
  VenuePrivateAdapterSpecSchema,
  PRIVATE_ADAPTER_SPECS,
} from './venue-credentials.js';

describe('VenueCredentialsSchema', () => {
  const valid = {
    venue: 'derive',
    label: 'main',
    fields: { walletAddress: '0xabc', privateKeyPem: '0xdef', subaccountId: '1' },
    addedAt: 1_700_000_000_000,
  };

  it('round-trips a valid credential record unchanged', () => {
    const result = VenueCredentialsSchema.safeParse(valid);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(valid);
  });

  it('rejects an unknown field key', () => {
    expect(
      VenueCredentialsSchema.safeParse({ ...valid, fields: { totallyMadeUp: 'x' } }).success,
    ).toBe(false);
  });

  it('rejects a negative or non-integer addedAt', () => {
    expect(VenueCredentialsSchema.safeParse({ ...valid, addedAt: -1 }).success).toBe(false);
    expect(VenueCredentialsSchema.safeParse({ ...valid, addedAt: 1.5 }).success).toBe(false);
  });

  it('rejects an unknown venue', () => {
    expect(VenueCredentialsSchema.safeParse({ ...valid, venue: 'kraken' }).success).toBe(false);
  });
});

describe('PRIVATE_ADAPTER_SPECS', () => {
  it('has an entry for every venue id', () => {
    expect(Object.keys(PRIVATE_ADAPTER_SPECS).sort()).toEqual([...VENUE_IDS].sort());
  });

  it('every spec validates against VenuePrivateAdapterSpecSchema', () => {
    for (const [venue, spec] of Object.entries(PRIVATE_ADAPTER_SPECS)) {
      const result = VenuePrivateAdapterSpecSchema.safeParse(spec);
      expect(result.success, `spec for ${venue} should be valid`).toBe(true);
    }
  });

  it('keys the record consistently with each spec.venue field', () => {
    for (const [venue, spec] of Object.entries(PRIVATE_ADAPTER_SPECS)) {
      expect(spec.venue).toBe(venue);
    }
  });
});
