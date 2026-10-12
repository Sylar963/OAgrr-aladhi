import { describe, expect, it } from 'vitest';
import { buildSurfaceAnalytics, buildSurfaceGridEntry } from './surface-grid.js';
import type { NormalizedOptionContract, VenueOptionChain } from './types.js';
import { EMPTY_GREEKS } from './types.js';

const price = (usd: number) => ({ raw: usd, rawCurrency: 'USD', usd });

function chain(expiry: string, atmIv: number): VenueOptionChain {
  const contracts: Record<string, NormalizedOptionContract> = {};
  for (const strike of [90, 100, 110])
    for (const right of ['call', 'put'] as const) {
      const symbol = `T-${expiry}-${strike}-${right}`;
      const moneyness = (100 - strike) / 40;
      contracts[symbol] = {
        venue: 'deribit',
        symbol,
        exchangeSymbol: symbol,
        base: 'T',
        settle: 'USD',
        expiry,
        expiryTs: null,
        strike,
        right,
        inverse: false,
        contractSize: 1,
        tickSize: null,
        minQty: null,
        makerFee: null,
        takerFee: null,
        greeks: {
          ...EMPTY_GREEKS,
          markIv: strike === 100 ? atmIv : atmIv + 0.05,
          delta: right === 'call' ? 0.5 + moneyness : -0.5 + moneyness,
        },
        quote: {
          bid: price(1),
          ask: price(1.2),
          mark: price(1.1),
          last: null,
          bidSize: 1,
          askSize: 1,
          underlyingPriceUsd: 100,
          indexPriceUsd: 100,
          volume24h: null,
          openInterest: null,
          openInterestUsd: null,
          volume24hUsd: null,
          estimatedFees: null,
          timestamp: 1,
          source: 'ws',
        },
      };
    }
  return { venue: 'deribit', underlying: 'T', expiry, asOf: 1, contracts };
}

describe('surface grid', () => {
  it('times an entry from the exact expiry when given, else the 08:00 UTC convention', () => {
    const expiry = '2099-01-10';
    const exact = Date.parse('2099-01-11T08:00:00Z');
    const withTs = buildSurfaceGridEntry('T', expiry, [chain(expiry, 0.3)], {
      venues: ['deribit'],
      expiryTs: exact,
    });
    const withoutTs = buildSurfaceGridEntry('T', expiry, [chain(expiry, 0.3)], {
      venues: ['deribit'],
    });
    expect(withTs.dte).toBe(withoutTs.dte + 1);
    expect(withTs.atmStrike?.strike).toBe(100);
    expect(withTs.surfaceRow.atm).toBeCloseTo(0.3);
  });

  it('assembles per-venue ATM points and the term structure across entries', () => {
    const entries = [
      buildSurfaceGridEntry('T', '2099-01-10', [chain('2099-01-10', 0.3)], { venues: ['deribit'] }),
      buildSurfaceGridEntry('T', '2099-03-10', [chain('2099-03-10', 0.4)], { venues: ['deribit'] }),
    ];
    const analytics = buildSurfaceAnalytics('T', entries, ['deribit']);
    expect(analytics.surface.map((row) => row.expiry)).toEqual(['2099-01-10', '2099-03-10']);
    expect(analytics.venueAtm.deribit?.map((point) => point.atm)).toEqual([0.3, 0.4]);
    expect(analytics.termStructure).toBe('contango');
    expect(analytics.venueSurfaceFine).toEqual({});
  });
});
