import type { CloseNowLeg } from '@oggregator/protocol';
import { describe, expect, it } from 'vitest';

import { fmtAge, giveBackLevel, legFillStatus, spreadNote, staleNote } from './close-now';

function leg(overrides: Partial<CloseNowLeg> = {}): CloseNowLeg {
  return {
    legId: 'leg-1',
    venue: 'thalex',
    instrument: 'BTC-27NOV26-110000-C',
    status: 'ok',
    unavailableReason: null,
    side: 'sell',
    size: 5,
    filledSize: 5,
    exitVwapUsd: 1_400,
    feesUsd: 75,
    exitCashUsd: 6_925,
    venueMarkUsd: 1_500,
    collarLimitUsd: 1_000,
    markPnlUsd: 2_500,
    closeNowPnlUsd: 1_925,
    exitCostUsd: 575,
    giveBackPct: 23,
    spread: { bidUsd: 1_400, askUsd: 1_600, widthPct: 13.3, typicalWidthPct: 4, widthVsTypical: 3.3 },
    stale: false,
    bookAgeMs: 400,
    peak: null,
    ...overrides,
  };
}

describe('giveBackLevel', () => {
  it('bands give-back into green, amber and red', () => {
    expect(giveBackLevel(5)).toBe('ok');
    expect(giveBackLevel(20)).toBe('warn');
    expect(giveBackLevel(50)).toBe('warn');
    expect(giveBackLevel(70)).toBe('alert');
    expect(giveBackLevel(null)).toBeNull();
  });
});

describe('legFillStatus', () => {
  it('spells out partial fills, missing bids and unsupported venues', () => {
    expect(legFillStatus(leg({ status: 'partial', filledSize: 2 }))).toBe('partial: 2 of 5 fillable');
    expect(legFillStatus(leg({ status: 'no_bid' }))).toBe('no bid');
    expect(legFillStatus(leg({ status: 'unsupported_venue', venue: 'deribit' }))).toBe('no deribit depth yet');
    expect(legFillStatus(leg({ status: 'book_unavailable', unavailableReason: 'capacity' }))).toBe('book limit reached');
  });
});

describe('notes', () => {
  it('flags a stale book with its age and a spread far wider than usual', () => {
    expect(staleNote(leg())).toBeNull();
    expect(staleNote(leg({ stale: true, unavailableReason: 'unsynchronized', bookAgeMs: 42_000 }))).toBe(
      'book resyncing · last book 42s ago',
    );
    expect(spreadNote(leg())).toContain('quotes pulled');
    expect(spreadNote(leg({ spread: { bidUsd: 1, askUsd: 2, widthPct: 5, typicalWidthPct: null, widthVsTypical: null } }))).toBe(
      'spread 5.0% (typical: sampling)',
    );
    expect(fmtAge(90_000)).toBe('2m');
  });
});
