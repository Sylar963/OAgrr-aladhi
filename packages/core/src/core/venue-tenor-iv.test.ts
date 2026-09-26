import { describe, expect, it } from 'vitest';
import type { VenueId } from '../types/common.js';
import type { EnrichedStrike, VenueQuote } from './enrichment.js';
import { computeVenueTenorIvs, type VenueTenorIvInput } from './venue-tenor-iv.js';

function quote(markIv: number, delta: number): VenueQuote {
  return { markIv, delta } as VenueQuote;
}

type VenueIvs = Partial<Record<VenueId, number>>;

function strike(price: number, callDelta: number, ivs: VenueIvs): EnrichedStrike {
  const side = (delta: number) => ({
    venues: Object.fromEntries(
      Object.entries(ivs).map(([venue, iv]) => [venue, quote(iv!, delta)]),
    ),
    bestIv: null,
    bestVenue: null,
  });
  return { strike: price, call: side(callDelta), put: side(callDelta - 1) };
}

function expiry(dte: number, atm: VenueIvs, wings: VenueIvs = atm): VenueTenorIvInput {
  return {
    expiry: `D${dte}`,
    dte,
    referencePriceUsd: 60_000,
    strikes: [
      strike(50_000, 0.75, wings),
      strike(60_000, 0.5, atm),
      strike(70_000, 0.25, wings),
    ],
  };
}

describe('computeVenueTenorIvs', () => {
  it("uses only each venue's own quotes", () => {
    const points = computeVenueTenorIvs(
      [expiry(7, { deribit: 0.5, okx: 0.7 }), expiry(35, { deribit: 0.5, okx: 0.7 })],
      [30],
    );
    expect(points.map((p) => [p.venue, p.atmIv])).toEqual([
      ['deribit', 0.5],
      ['okx', 0.7],
    ]);
  });

  it('omits tenors outside the venue expiry range instead of extrapolating', () => {
    const points = computeVenueTenorIvs(
      [
        expiry(3, { okx: 0.6 }),
        expiry(7, { deribit: 0.5, okx: 0.6 }),
        expiry(35, { deribit: 0.55 }),
      ],
      [7, 30],
    );
    expect(points.map((p) => `${p.venue}:${p.tenorDays}`)).toEqual([
      'deribit:7',
      'deribit:30',
      'okx:7',
    ]);
  });

  it('interpolates in total variance and derives risk reversal and butterfly', () => {
    const [point] = computeVenueTenorIvs(
      [expiry(10, { deribit: 0.5 }, { deribit: 0.6 }), expiry(40, { deribit: 0.5 }, { deribit: 0.6 })],
      [30],
    );
    expect(point!.atmIv).toBeCloseTo(0.5, 10);
    expect(point!.rr25d).toBeCloseTo(0, 10);
    expect(point!.bfly25d).toBeCloseTo(0.1, 10);
  });
});
