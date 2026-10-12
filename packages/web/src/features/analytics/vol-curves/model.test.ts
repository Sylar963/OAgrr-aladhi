import { describe, expect, it } from 'vitest';
import type { EnrichedChainResponse, EnrichedStrike, VenueQuote } from '@shared/enriched';

import {
  buildCurves,
  buildSmilePoints,
  computeYDomain,
  defaultFocus,
  defaultXDomain,
  formatDeltaLabel,
  isDefaultVisible,
  medianSpreadVol,
  niceTicks,
  putDeltaAbs,
  venueQuotes,
  type SmileCurve,
} from './model';

interface Q {
  bidIv?: number | null;
  askIv?: number | null;
  markIv?: number | null;
  oiUsd?: number;
}

function quote(q: Q): VenueQuote {
  return {
    bid: q.bidIv != null ? 10 : null,
    ask: q.askIv != null ? 12 : null,
    mid: 11,
    midRaw: 11,
    bidSize: 1,
    askSize: 1,
    markIv: q.markIv ?? null,
    bidIv: q.bidIv ?? null,
    askIv: q.askIv ?? null,
    delta: null,
    gamma: null,
    theta: null,
    vega: null,
    spreadPct: null,
    totalCost: null,
    estimatedFees: null,
    openInterest: 5,
    volume24h: null,
    openInterestUsd: q.oiUsd ?? 0,
    volume24hUsd: null,
  };
}

function strike(
  k: number,
  call: Record<string, Q> = {},
  put: Record<string, Q> = {},
): EnrichedStrike {
  const side = (legs: Record<string, Q>) => ({
    venues: Object.fromEntries(Object.entries(legs).map(([v, q]) => [v, quote(q)])),
    bestIv: null,
    bestVenue: null,
  });
  return { strike: k, call: side(call), put: side(put) } as EnrichedStrike;
}

function chain(expiry: string, dte: number, strikes: EnrichedStrike[]): EnrichedChainResponse {
  return {
    underlying: 'BTC',
    expiry,
    expiryTs: null,
    dte,
    stats: {
      forwardPriceUsd: 100_000,
      indexPriceUsd: 100_000,
      basisPct: null,
      atmStrike: null,
      atmIv: 0.5,
      putCallOiRatio: null,
      totalOiUsd: null,
      skew25d: -0.03,
      bfly25d: null,
    },
    strikes,
    gex: [],
  };
}

function smileStrikes(): EnrichedStrike[] {
  return [80_000, 90_000, 95_000, 100_000, 105_000, 110_000, 120_000].map((k) =>
    strike(
      k,
      { deribit: { markIv: 0.5, bidIv: 0.49, askIv: 0.51 } },
      { deribit: { markIv: 0.55, bidIv: 0.54, askIv: 0.56 } },
    ),
  );
}

describe('venueQuotes', () => {
  it('takes the highest bid and lowest ask across venues, not the average', () => {
    const s = strike(100_000, {
      deribit: { bidIv: 0.5, askIv: 0.56, markIv: 0.53, oiUsd: 100 },
      okx: { bidIv: 0.52, askIv: 0.58, markIv: 0.55, oiUsd: 50 },
      bybit: { bidIv: 0.48, askIv: 0.54, markIv: 0.51 },
    });
    const q = venueQuotes(s.call);
    expect(q.bestBid).toEqual({ iv: 0.52, venue: 'okx' });
    expect(q.bestAsk).toEqual({ iv: 0.54, venue: 'bybit' });
    expect(q.oiUsd).toBe(150);
    expect(q.venues).toHaveLength(3);
  });

  it('ignores IVs outside the sanity band', () => {
    const s = strike(100_000, { deribit: { bidIv: 0.01, askIv: 7, markIv: 0.5 } });
    const q = venueQuotes(s.call);
    expect(q.bestBid).toBeNull();
    expect(q.bestAsk).toBeNull();
  });
});

describe('buildSmilePoints', () => {
  it('uses the OTM contract for bid/ask and flags cross-venue crossed markets', () => {
    const points = buildSmilePoints(
      [
        strike(90_000, { deribit: { bidIv: 0.9, askIv: 0.95, markIv: 0.92 } }, {
          deribit: { bidIv: 0.6, askIv: 0.62, markIv: 0.61 },
          okx: { bidIv: 0.63, askIv: 0.66, markIv: 0.64 },
        }),
        strike(110_000, { deribit: { bidIv: 0.5, askIv: 0.52, markIv: 0.51 } }),
      ],
      100_000,
      30 / 365,
    );
    const below = points.find((p) => p.strike === 90_000)!;
    expect(below.side).toBe('put');
    expect(below.bestBid).toEqual({ iv: 0.63, venue: 'okx' });
    expect(below.bestAsk).toEqual({ iv: 0.62, venue: 'deribit' });
    expect(below.crossed).toBe(true);
    const above = points.find((p) => p.strike === 110_000)!;
    expect(above.side).toBe('call');
    expect(above.crossed).toBe(false);
  });

  it('places strikes on a delta axis that rises with strike', () => {
    const points = buildSmilePoints(smileStrikes(), 100_000, 30 / 365);
    const xs = points.map((p) => p.x!);
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThan(xs[i - 1]!);
    const atm = points.find((p) => p.strike === 100_000)!;
    expect(atm.x).toBeGreaterThan(0.4);
    expect(atm.x).toBeLessThan(0.6);
  });

  it('drops an isolated wing spike but keeps the strike for its bid/ask', () => {
    const strikes = smileStrikes();
    strikes.push(
      strike(130_000, { deribit: { markIv: 2, bidIv: 1.5, askIv: 2.5 } }),
      strike(140_000, { deribit: { markIv: 0.6, bidIv: 0.58, askIv: 0.62 } }),
    );
    const points = buildSmilePoints(strikes, 100_000, 30 / 365);
    const spike = points.find((p) => p.strike === 130_000)!;
    expect(spike.markIv).toBeNull();
    expect(spike.bestBid?.iv).toBe(1.5);
  });
});

describe('putDeltaAbs', () => {
  it('is 0.5 at the forward for vanishing vol·time and null without inputs', () => {
    expect(putDeltaAbs(100, 100, 1e-8, 0.5)).toBeCloseTo(0.5, 3);
    expect(putDeltaAbs(100, 100, null, 0.5)).toBeNull();
  });
});

describe('curve selection', () => {
  const curves = buildCurves(
    [
      chain('2026-10-13', 1, smileStrikes()),
      chain('2026-10-16', 4, smileStrikes()),
      chain('2026-11-06', 25, smileStrikes()),
      chain('2026-12-25', 74, smileStrikes()),
    ],
    100_000,
    Date.parse('2026-10-12T08:00:00Z'),
  );

  it('sorts by tenor and hides sub-2-day expiries by default', () => {
    expect(curves.map((c) => c.dte)).toEqual([1, 4, 25, 74]);
    expect(curves.map(isDefaultVisible)).toEqual([false, true, true, true]);
  });

  it('focuses the expiry nearest 30 days', () => {
    expect(defaultFocus(curves)).toBe('2026-11-06');
  });

  it('limits the default strike window to ±30% of spot', () => {
    expect(defaultXDomain('strike', curves, 100_000)).toEqual([80_000, 120_000]);
    expect(defaultXDomain('delta', curves, 100_000)).toEqual([0.03, 0.97]);
  });
});

describe('computeYDomain', () => {
  function flatCurve(expiry: string, iv: number, spikeIv?: number): SmileCurve {
    const strikes = Array.from({ length: 30 }, (_, i) => 90_000 + i * 1000);
    return {
      expiry,
      label: expiry,
      dte: 30,
      color: 'hsl(180, 55%, 72%)',
      forward: 100_000,
      atmIv: iv,
      rr25: null,
      points: strikes.map((k, i) => ({
        strike: k,
        side: 'call',
        markIv: spikeIv != null && i === 0 ? spikeIv : iv,
        x: null,
        bestBid: { iv: iv - 0.01, venue: 'deribit' },
        bestAsk: { iv: iv + 0.5, venue: 'deribit' },
        crossed: false,
        oiUsd: 0,
        venues: [],
      })),
    };
  }

  it('caps a single outlier mark and limits how far wide asks stretch the range', () => {
    const a = flatCurve('a', 0.4, 3);
    const b = flatCurve('b', 0.5);
    const [lo, hi] = computeYDomain([a, b], b, 'strike', [90_000, 120_000])!;
    expect(lo).toBeLessThan(0.4);
    expect(hi).toBeLessThan(0.6);
  });

  it('only considers points inside the visible x window', () => {
    const a = flatCurve('a', 0.4);
    expect(computeYDomain([a], null, 'strike', [200_000, 300_000])).toBeNull();
  });
});

describe('formatting helpers', () => {
  it('labels delta positions by OTM side', () => {
    expect(formatDeltaLabel(0.25)).toBe('25Δp');
    expect(formatDeltaLabel(0.5)).toBe('ATM');
    expect(formatDeltaLabel(0.9)).toBe('10Δc');
  });

  it('produces round tick steps', () => {
    expect(niceTicks(80_000, 120_000, 4)).toEqual([80_000, 90_000, 100_000, 110_000, 120_000]);
    expect(niceTicks(1, 0, 4)).toEqual([]);
  });

  it('reports median spread excluding crossed strikes', () => {
    const points = buildSmilePoints(smileStrikes(), 100_000, 30 / 365);
    expect(medianSpreadVol(points)).toBeCloseTo(0.02, 6);
  });
});
