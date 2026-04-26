// packages/web/src/features/analytics/oi-by-strike/oi-heatmap-utils.test.ts
import { describe, it, expect } from 'vitest';
import type { EnrichedChainResponse } from '@shared/enriched';

import { aggregateHeatRows } from './oi-heatmap-utils';

function venueQuote(openInterest: number, openInterestUsd: number) {
  return {
    bid: null, ask: null, mid: null,
    iv: null, delta: null, gamma: null, vega: null, theta: null, rho: null,
    openInterest,
    openInterestUsd,
    volume24h: null,
    volume24hUsd: null,
    feeBps: null,
    timestamp: 0,
  };
}

function chain(expiry: string, dte: number, strikes: Array<{
  strike: number;
  call?: { venue: string; oi: number; oiUsd: number };
  put?: { venue: string; oi: number; oiUsd: number };
}>): EnrichedChainResponse {
  return {
    underlying: 'BTC',
    expiry,
    dte,
    strikes: strikes.map((s) => ({
      strike: s.strike,
      call: { venues: s.call ? { [s.call.venue]: venueQuote(s.call.oi, s.call.oiUsd) } : {} },
      put:  { venues: s.put  ? { [s.put.venue]:  venueQuote(s.put.oi,  s.put.oiUsd)  } : {} },
    })),
    stats: { forwardPriceUsd: null, atmIv: null, atmStrike: null, rr25d: null, bfly25d: null },
  } as unknown as EnrichedChainResponse;
}

describe('aggregateHeatRows', () => {
  it('returns empty array when chains is empty', () => {
    expect(aggregateHeatRows([], 80_000, 'contracts', new Set(), 'both')).toEqual([]);
  });

  it('filters strikes outside spot ± 30%', () => {
    const c = chain('2026-04-30', 4, [
      { strike: 50_000, call: { venue: 'deribit', oi: 10, oiUsd: 100_000 } },  // -37.5% → out
      { strike: 80_000, call: { venue: 'deribit', oi: 20, oiUsd: 200_000 } },  // 0% → in
      { strike: 110_000, call: { venue: 'deribit', oi: 30, oiUsd: 300_000 } }, // +37.5% → out
    ]);
    const rows = aggregateHeatRows([c], 80_000, 'contracts', new Set(), 'both');
    expect(rows.map((r) => r.strike)).toEqual([80_000]);
  });

  it('mode "contracts" sums openInterest; mode "notional" sums openInterestUsd', () => {
    const c = chain('2026-04-30', 4, [
      { strike: 80_000, call: { venue: 'deribit', oi: 5, oiUsd: 500_000 } },
    ]);
    const contracts = aggregateHeatRows([c], 80_000, 'contracts', new Set(), 'both');
    const notional  = aggregateHeatRows([c], 80_000, 'notional',  new Set(), 'both');
    expect(contracts[0]!.callOi).toBe(5);
    expect(notional[0]!.callOi).toBe(500_000);
  });

  it('side "calls" puts only call OI in magnitude; "puts" only put OI; "both" sums them', () => {
    const c = chain('2026-04-30', 4, [
      {
        strike: 80_000,
        call: { venue: 'deribit', oi: 7, oiUsd: 70 },
        put:  { venue: 'deribit', oi: 3, oiUsd: 30 },
      },
    ]);
    const calls = aggregateHeatRows([c], 80_000, 'contracts', new Set(), 'calls');
    const puts  = aggregateHeatRows([c], 80_000, 'contracts', new Set(), 'puts');
    const both  = aggregateHeatRows([c], 80_000, 'contracts', new Set(), 'both');
    expect(calls[0]!.magnitude).toBe(7);
    expect(puts[0]!.magnitude).toBe(3);
    expect(both[0]!.magnitude).toBe(10);
  });

  it('dominant is "call" when callOi >= putOi, "put" otherwise', () => {
    const tied = chain('2026-04-30', 4, [
      {
        strike: 80_000,
        call: { venue: 'deribit', oi: 5, oiUsd: 50 },
        put:  { venue: 'deribit', oi: 5, oiUsd: 50 },
      },
    ]);
    const callDom = chain('2026-04-30', 4, [
      {
        strike: 80_000,
        call: { venue: 'deribit', oi: 10, oiUsd: 100 },
        put:  { venue: 'deribit', oi: 1, oiUsd: 10 },
      },
    ]);
    const putDom = chain('2026-04-30', 4, [
      {
        strike: 80_000,
        call: { venue: 'deribit', oi: 1, oiUsd: 10 },
        put:  { venue: 'deribit', oi: 10, oiUsd: 100 },
      },
    ]);
    expect(aggregateHeatRows([tied],    80_000, 'contracts', new Set(), 'both')[0]!.dominant).toBe('call');
    expect(aggregateHeatRows([callDom], 80_000, 'contracts', new Set(), 'both')[0]!.dominant).toBe('call');
    expect(aggregateHeatRows([putDom],  80_000, 'contracts', new Set(), 'both')[0]!.dominant).toBe('put');
  });

  it('excludes hidden expiries from the OI sum', () => {
    const a = chain('2026-04-27', 1, [{ strike: 80_000, call: { venue: 'deribit', oi: 4, oiUsd: 40 } }]);
    const b = chain('2026-04-28', 2, [{ strike: 80_000, call: { venue: 'deribit', oi: 6, oiUsd: 60 } }]);
    const all   = aggregateHeatRows([a, b], 80_000, 'contracts', new Set(),               'both');
    const onlyA = aggregateHeatRows([a, b], 80_000, 'contracts', new Set(['2026-04-28']), 'both');
    expect(all[0]!.callOi).toBe(10);
    expect(onlyA[0]!.callOi).toBe(4);
  });

  it('returns empty array when every expiry is hidden', () => {
    const a = chain('2026-04-27', 1, [{ strike: 80_000, call: { venue: 'deribit', oi: 4, oiUsd: 40 } }]);
    const rows = aggregateHeatRows([a], 80_000, 'contracts', new Set(['2026-04-27']), 'both');
    expect(rows).toEqual([]);
  });

  it('returns rows sorted ascending by strike', () => {
    const c = chain('2026-04-30', 4, [
      { strike: 79_000, call: { venue: 'deribit', oi: 1, oiUsd: 10 } },
      { strike: 81_000, call: { venue: 'deribit', oi: 1, oiUsd: 10 } },
      { strike: 80_000, call: { venue: 'deribit', oi: 1, oiUsd: 10 } },
    ]);
    const rows = aggregateHeatRows([c], 80_000, 'contracts', new Set(), 'both');
    expect(rows.map((r) => r.strike)).toEqual([79_000, 80_000, 81_000]);
  });
});
