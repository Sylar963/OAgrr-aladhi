import { describe, expect, it } from 'vitest';

import {
  FINE_DELTA_GRID,
  ULTRA_FINE_DELTA_GRID,
  type EnrichedStrike,
  type IvSurfaceFineRow,
  type VenueQuote,
} from './enrichment.js';
import {
  computeCmmIvSurface,
  fillRowLinear,
  fitRowFromStrikesSvi,
  liftRowToGrid,
  smoothFineSurfaceRow,
  DENSE_CMM_TENORS,
} from './iv-surface-smoothing.js';
import { fitSvi, sviIv } from '../services/svi-fit.js';

function createQuote(partial: Partial<VenueQuote> = {}): VenueQuote {
  return {
    bid: null,
    ask: null,
    mid: null,
    midRaw: null,
    bidSize: null,
    askSize: null,
    markIv: null,
    bidIv: null,
    askIv: null,
    delta: null,
    gamma: null,
    theta: null,
    vega: null,
    spreadPct: null,
    totalCost: null,
    estimatedFees: null,
    openInterest: null,
    volume24h: null,
    openInterestUsd: null,
    volume24hUsd: null,
    ...partial,
  };
}

function syntheticSmile(
  refPrice: number,
  T: number,
  strikes: number[],
  atmIv: number,
  skew: number,
  curvature: number,
): EnrichedStrike[] {
  return strikes.map((K) => {
    const k = Math.log(K / refPrice);
    const iv = atmIv + skew * k + curvature * k * k;
    return {
      strike: K,
      call: {
        bestIv: iv,
        bestVenue: 'deribit',
        venues: { deribit: createQuote({ markIv: iv }) },
      },
      put: {
        bestIv: iv,
        bestVenue: 'deribit',
        venues: { deribit: createQuote({ markIv: iv }) },
      },
    } satisfies EnrichedStrike;
  });
}

describe('fillRowLinear', () => {
  it('linearly interpolates internal nulls', () => {
    const ivs: (number | null)[] = [0.5, null, null, 0.8, null, 1.0];
    const out = fillRowLinear(ivs);
    expect(out[0]).toBeCloseTo(0.5, 6);
    expect(out[1]).toBeCloseTo(0.6, 6);
    expect(out[2]).toBeCloseTo(0.7, 6);
    expect(out[3]).toBeCloseTo(0.8, 6);
    expect(out[4]).toBeCloseTo(0.9, 6);
    expect(out[5]).toBeCloseTo(1.0, 6);
  });

  it('flat-extrapolates leading and trailing nulls', () => {
    const ivs: (number | null)[] = [null, null, 0.4, 0.6, null];
    const out = fillRowLinear(ivs);
    expect(out[0]).toBeCloseTo(0.4, 6);
    expect(out[1]).toBeCloseTo(0.4, 6);
    expect(out[2]).toBeCloseTo(0.4, 6);
    expect(out[3]).toBeCloseTo(0.6, 6);
    expect(out[4]).toBeCloseTo(0.6, 6);
  });

  it('returns the row unchanged when fewer than 2 points are observed', () => {
    expect(fillRowLinear([null, null, 0.5, null])).toEqual([null, null, 0.5, null]);
    expect(fillRowLinear([null, null, null])).toEqual([null, null, null]);
  });
});

describe('fitRowFromStrikesSvi', () => {
  it('fills the full delta grid when SVI fit succeeds', () => {
    const refPrice = 100_000;
    const T = 30 / 365;
    const strikes = [70_000, 80_000, 90_000, 100_000, 110_000, 120_000, 130_000];
    const enriched = syntheticSmile(refPrice, T, strikes, 0.6, -0.1, 0.5);

    const ivs = fitRowFromStrikesSvi(enriched, refPrice, T);
    expect(ivs).not.toBeNull();
    expect(ivs).toHaveLength(FINE_DELTA_GRID.length);
    for (const v of ivs ?? []) {
      expect(v).not.toBeNull();
      expect(v!).toBeGreaterThan(0.05);
      expect(v!).toBeLessThan(5);
    }
  });

  it('returns null when fewer than 5 valid points are available', () => {
    const refPrice = 100_000;
    const T = 30 / 365;
    const strikes = syntheticSmile(refPrice, T, [90_000, 100_000, 110_000], 0.6, -0.1, 0.5);
    expect(fitRowFromStrikesSvi(strikes, refPrice, T)).toBeNull();
  });

  it('holds IV flat beyond the outermost listed strike', () => {
    const refPrice = 100;
    const T = 2;
    const strikes = syntheticSmile(refPrice, T, [40, 50, 60, 70, 80, 90, 100, 110, 120], 0.45, -0.1, 0.1);
    const ivs = fitRowFromStrikesSvi(strikes, refPrice, T, ULTRA_FINE_DELTA_GRID);
    expect(ivs).not.toBeNull();
    const edgeCallIv = strikes.at(-1)!.call.bestIv!;
    expect(ivs!.at(-1)!).toBeCloseTo(edgeCallIv, 2);
  });

  it('rejects bad reference price or tenor', () => {
    const refPrice = 100_000;
    const T = 30 / 365;
    const strikes = syntheticSmile(refPrice, T, [90_000, 100_000, 110_000, 120_000, 130_000], 0.6, -0.1, 0.5);
    expect(fitRowFromStrikesSvi(strikes, 0, T)).toBeNull();
    expect(fitRowFromStrikesSvi(strikes, refPrice, 0)).toBeNull();
  });
});

describe('smoothFineSurfaceRow', () => {
  it('uses SVI when fittable and fills every bucket', () => {
    const refPrice = 100_000;
    const T = 30 / 365;
    const strikes = syntheticSmile(
      refPrice,
      T,
      [70_000, 80_000, 90_000, 100_000, 110_000, 120_000, 130_000],
      0.6,
      -0.1,
      0.5,
    );
    const raw: IvSurfaceFineRow = {
      expiry: '2026-04-04',
      dte: 30,
      ivs: FINE_DELTA_GRID.map(() => null),
    };
    const out = smoothFineSurfaceRow(raw, strikes, refPrice, T);
    expect(out.ivs.every((v) => v != null)).toBe(true);
  });

  it('falls back to linear fill when too few strikes for SVI', () => {
    const refPrice = 100_000;
    const T = 30 / 365;
    const strikes = syntheticSmile(refPrice, T, [], 0.6, 0, 0);
    const raw: IvSurfaceFineRow = {
      expiry: '2026-04-04',
      dte: 30,
      ivs: [null, null, 0.5, null, null, null, null, null, null, 0.55, null, null, null, null, null, null, null, null, 0.6],
    };
    const out = smoothFineSurfaceRow(raw, strikes, refPrice, T);
    expect(out.ivs.every((v) => v != null)).toBe(true);
    expect(out.ivs[0]).toBeCloseTo(0.5, 6);
    expect(out.ivs[FINE_DELTA_GRID.length - 1]).toBeCloseTo(0.6, 6);
  });
});

describe('computeCmmIvSurface', () => {
  it('returns one row per CMM tenor inside the listed DTE range', () => {
    const rows: IvSurfaceFineRow[] = [
      { expiry: '2026-05-13', dte: 7, ivs: FINE_DELTA_GRID.map(() => 0.5) },
      { expiry: '2026-06-05', dte: 30, ivs: FINE_DELTA_GRID.map(() => 0.55) },
      { expiry: '2026-08-04', dte: 90, ivs: FINE_DELTA_GRID.map(() => 0.6) },
    ];
    const cmm = computeCmmIvSurface(rows);
    const tenors = cmm.map((r) => r.tenorDays);
    expect(tenors).toEqual([7, 14, 30, 60, 90]);
  });

  it('interpolates in total variance between bracketing rows', () => {
    const rows: IvSurfaceFineRow[] = [
      { expiry: '2026-05-13', dte: 10, ivs: FINE_DELTA_GRID.map(() => 0.5) },
      { expiry: '2026-06-05', dte: 40, ivs: FINE_DELTA_GRID.map(() => 0.6) },
    ];
    const cmm = computeCmmIvSurface(rows, [25]);
    expect(cmm).toHaveLength(1);
    const v = cmm[0]!.ivs[0]!;
    const wLo = 0.5 * 0.5 * 10;
    const wHi = 0.6 * 0.6 * 40;
    const wTarget = wLo + (wHi - wLo) * ((25 - 10) / (40 - 10));
    expect(v).toBeCloseTo(Math.sqrt(wTarget / 25), 6);
  });

  it('drops CMM tenors outside the listed DTE range', () => {
    const rows: IvSurfaceFineRow[] = [
      { expiry: '2026-05-13', dte: 30, ivs: FINE_DELTA_GRID.map(() => 0.5) },
      { expiry: '2026-06-05', dte: 60, ivs: FINE_DELTA_GRID.map(() => 0.55) },
    ];
    const cmm = computeCmmIvSurface(rows);
    const tenors = cmm.map((r) => r.tenorDays);
    expect(tenors).toEqual([30, 60]);
  });

  it('returns empty when no rows have positive DTE', () => {
    expect(computeCmmIvSurface([])).toEqual([]);
    expect(
      computeCmmIvSurface([
        { expiry: '2026-05-06', dte: 0, ivs: FINE_DELTA_GRID.map(() => 0.5) },
      ]),
    ).toEqual([]);
  });

  it('preserves dense grid length when rows align to ULTRA_FINE_DELTA_GRID', () => {
    const rows: IvSurfaceFineRow[] = [
      { expiry: '2026-05-13', dte: 10, ivs: ULTRA_FINE_DELTA_GRID.map(() => 0.5) },
      { expiry: '2026-06-05', dte: 40, ivs: ULTRA_FINE_DELTA_GRID.map(() => 0.6) },
    ];
    const cmm = computeCmmIvSurface(rows, [25]);
    expect(cmm).toHaveLength(1);
    expect(cmm[0]!.ivs).toHaveLength(ULTRA_FINE_DELTA_GRID.length);
  });

  it('emits one row per dense tenor inside the listed DTE range', () => {
    const rows: IvSurfaceFineRow[] = [
      { expiry: '2026-05-13', dte: 7, ivs: ULTRA_FINE_DELTA_GRID.map(() => 0.5) },
      { expiry: '2026-08-04', dte: 90, ivs: ULTRA_FINE_DELTA_GRID.map(() => 0.6) },
    ];
    const cmm = computeCmmIvSurface(rows, DENSE_CMM_TENORS);
    expect(cmm.length).toBeGreaterThan(20);
    for (const row of cmm) {
      expect(row.tenorDays).toBeGreaterThanOrEqual(7);
      expect(row.tenorDays).toBeLessThanOrEqual(90);
      expect(row.ivs).toHaveLength(ULTRA_FINE_DELTA_GRID.length);
    }
  });
});

describe('ULTRA_FINE_DELTA_GRID sampling', () => {
  it('fitRowFromStrikesSvi fills the dense grid when given ULTRA_FINE_DELTA_GRID', () => {
    const refPrice = 100_000;
    const T = 30 / 365;
    const strikes = syntheticSmile(
      refPrice,
      T,
      [70_000, 80_000, 90_000, 100_000, 110_000, 120_000, 130_000],
      0.6,
      -0.1,
      0.5,
    );
    const ivs = fitRowFromStrikesSvi(strikes, refPrice, T, ULTRA_FINE_DELTA_GRID);
    expect(ivs).not.toBeNull();
    expect(ivs).toHaveLength(ULTRA_FINE_DELTA_GRID.length);
    expect(ivs!.every((v) => v != null)).toBe(true);
  });

  it('smoothFineSurfaceRow returns dense ivs when given ULTRA_FINE_DELTA_GRID, even via linear fallback', () => {
    const refPrice = 100_000;
    const T = 30 / 365;
    const noStrikes: EnrichedStrike[] = [];
    const raw: IvSurfaceFineRow = {
      expiry: '2026-04-04',
      dte: 30,
      ivs: [null, null, 0.5, null, null, null, null, null, null, 0.55, null, null, null, null, null, null, null, null, 0.6],
    };
    const out = smoothFineSurfaceRow(raw, noStrikes, refPrice, T, ULTRA_FINE_DELTA_GRID);
    expect(out.ivs).toHaveLength(ULTRA_FINE_DELTA_GRID.length);
    expect(out.ivs.every((v) => v != null)).toBe(true);
  });
});

describe('liftRowToGrid', () => {
  it('upsamples a coarse row onto a finer grid via linear interpolation', () => {
    const lifted = liftRowToGrid(
      FINE_DELTA_GRID.map((d) => d),
      FINE_DELTA_GRID,
      ULTRA_FINE_DELTA_GRID,
    );
    expect(lifted).toHaveLength(ULTRA_FINE_DELTA_GRID.length);
    for (let i = 0; i < ULTRA_FINE_DELTA_GRID.length; i++) {
      expect(lifted[i]).toBeCloseTo(ULTRA_FINE_DELTA_GRID[i]!, 6);
    }
  });

  it('returns the row as-is when source and target grids are identical', () => {
    const raw: (number | null)[] = FINE_DELTA_GRID.map((_, i) => i / 10);
    const lifted = liftRowToGrid(raw, FINE_DELTA_GRID, FINE_DELTA_GRID);
    expect(lifted).toEqual(raw);
  });
});

// TastyTrade ADBE 2027-03-19, spot 262.8, 2026-10-25: [strike, callIv, putIv]. Deep-ITM IVs
// disagree with the OTM side by up to 0.2, and SVI once fitted this slice at 122–154% IV.
const ADBE_MAR27: [number, number, number][] = [
  [100, 0.857, 0.646], [105, 0.831, 0.623], [110, 0.818, 0.599], [115, 0.806, 0.577],
  [120, 0.791, 0.554], [125, 0.775, 0.533], [130, 0.758, 0.52], [135, 0.74, 0.526],
  [140, 0.722, 0.527], [145, 0.702, 0.524], [150, 0.683, 0.516], [155, 0.663, 0.507],
  [160, 0.646, 0.498], [165, 0.633, 0.498], [170, 0.623, 0.495], [175, 0.612, 0.489],
  [180, 0.6, 0.481], [185, 0.589, 0.471], [190, 0.577, 0.461], [195, 0.564, 0.455],
  [200, 0.552, 0.449], [210, 0.546, 0.448], [220, 0.538, 0.443], [230, 0.523, 0.435],
  [240, 0.506, 0.431], [250, 0.498, 0.435], [260, 0.489, 0.434], [270, 0.485, 0.425],
  [280, 0.487, 0.409], [290, 0.486, 0.395], [300, 0.478, 0.385], [310, 0.466, 0.377],
  [320, 0.46, 0.376], [330, 0.46, 0.374], [340, 0.459, 0.369], [350, 0.456, 0.362],
  [360, 0.458, 0.349], [370, 0.46, 0.326], [380, 0.458, 0.315], [390, 0.456, 0.319],
  [400, 0.458, 0.327], [410, 0.461, 0.333], [420, 0.468, 0.345], [430, 0.475, 0.358],
];
const ADBE_SPOT = 262.8;
const ADBE_T = 0.398;

describe('SVI on a TastyTrade equity slice', () => {
  it('never accepts a fit that misses its inputs', () => {
    const averaged = ADBE_MAR27.map(([K, c, p]) => ({ k: Math.log(K / ADBE_SPOT), iv: (c + p) / 2 }));
    const otm = ADBE_MAR27.map(([K, c, p]) => ({ k: Math.log(K / ADBE_SPOT), iv: K >= ADBE_SPOT ? c : p }));
    for (const points of [averaged, otm]) {
      const fit = fitSvi(points, ADBE_T);
      if (fit == null) continue;
      for (const { k, iv } of points) expect(Math.abs(sviIv(fit, k, ADBE_T) - iv)).toBeLessThan(0.15);
    }
  });

  it('keeps the smoothed row within the observed IV range', () => {
    const strikes: EnrichedStrike[] = ADBE_MAR27.map(([K, c, p]) => ({
      strike: K,
      call: { bestIv: c, bestVenue: 'deribit', venues: { deribit: createQuote({ markIv: c }) } },
      put: { bestIv: p, bestVenue: 'deribit', venues: { deribit: createQuote({ markIv: p }) } },
    }));
    const raw: IvSurfaceFineRow = {
      expiry: '2027-03-19',
      dte: 146,
      ivs: [0.5, 0.47, 0.45, 0.44, 0.43, 0.43, 0.44, null, 0.43, 0.46, 0.49, 0.48, 0.47, 0.46, 0.46, 0.46, 0.46, 0.46, 0.47],
    };
    const out = smoothFineSurfaceRow(raw, strikes, ADBE_SPOT, ADBE_T, ULTRA_FINE_DELTA_GRID);
    expect(out.ivs).toHaveLength(ULTRA_FINE_DELTA_GRID.length);
    for (const iv of out.ivs) {
      expect(iv).not.toBeNull();
      expect(iv!).toBeGreaterThan(0.3);
      expect(iv!).toBeLessThan(0.7);
    }
  });
});
