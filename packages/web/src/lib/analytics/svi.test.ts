import { describe, it, expect } from 'vitest';
import { fitSvi, isButterflyArbFree, sviTotalVariance, sviIv, type SviParams } from './svi';

const TRUTH: SviParams = { a: 0.04, b: 0.4, rho: -0.3, m: 0.02, sigma: 0.1 };

function generateSlice(truth: SviParams, T: number, ks: number[]) {
  return ks.map((k) => ({ k, iv: Math.sqrt(sviTotalVariance(truth, k) / T) }));
}

describe('svi (web mirror)', () => {
  it('sviIv equals √(w/T) — no extra scaling', () => {
    const T = 0.25;
    expect(sviIv(TRUTH, 0, T)).toBeCloseTo(Math.sqrt(sviTotalVariance(TRUTH, 0) / T), 12);
  });

  it('recovers a known SVI slice within tight tolerance', () => {
    const T = 30 / 365;
    const ks = [-0.4, -0.3, -0.2, -0.1, -0.05, 0, 0.05, 0.1, 0.2, 0.3, 0.4];
    const fit = fitSvi(generateSlice(TRUTH, T, ks), T);
    expect(fit).not.toBeNull();
    for (const k of ks) {
      expect(sviTotalVariance(fit!, k)).toBeCloseTo(sviTotalVariance(TRUTH, k), 4);
    }
  });

  it('isButterflyArbFree accepts well-behaved params and rejects density-violating ones', () => {
    expect(isButterflyArbFree(TRUTH, -0.5, 0.5)).toBe(true);
    const violating: SviParams = { a: 0.001, b: 2.0, rho: -0.99, m: 0, sigma: 0.01 };
    expect(isButterflyArbFree(violating, -0.2, 0.2)).toBe(false);
  });

  it('returns null for fewer than 5 points or invalid T', () => {
    const T = 0.1;
    expect(fitSvi([], T)).toBeNull();
    expect(
      fitSvi(
        [
          { k: -0.1, iv: 0.5 },
          { k: 0, iv: 0.5 },
          { k: 0.1, iv: 0.5 },
          { k: 0.2, iv: 0.5 },
        ],
        T,
      ),
    ).toBeNull();
    const points = [
      { k: -0.2, iv: 0.5 },
      { k: -0.1, iv: 0.5 },
      { k: 0, iv: 0.5 },
      { k: 0.1, iv: 0.5 },
      { k: 0.2, iv: 0.5 },
    ];
    expect(fitSvi(points, 0)).toBeNull();
    expect(fitSvi(points, -1)).toBeNull();
  });
});

// TastyTrade ADBE 2027-03-19, spot 262.8, 2026-10-25: [strike, callIv, putIv]. The fitter once
// accepted this slice at ~170% ATM IV against ~45% inputs.
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

describe('svi (web mirror) — fit quality', () => {
  it('never accepts a fit that misses its inputs', () => {
    const T = 0.398;
    const spot = 262.8;
    const averaged = ADBE_MAR27.map(([K, c, p]) => ({ k: Math.log(K / spot), iv: (c + p) / 2 }));
    const otm = ADBE_MAR27.map(([K, c, p]) => ({ k: Math.log(K / spot), iv: K >= spot ? c : p }));
    for (const points of [averaged, otm]) {
      const fit = fitSvi(points, T);
      if (fit == null) continue;
      for (const { k, iv } of points) expect(Math.abs(sviIv(fit, k, T) - iv)).toBeLessThan(0.15);
    }
  });
});
