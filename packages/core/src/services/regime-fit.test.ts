import { describe, expect, it } from 'vitest';
import {
  type FitRequest,
  type HmmFitter,
  inProcessHmmFitter,
  packObservations,
  runFitRequest,
  unpackObservations,
} from './regime-fit.js';
import { fitGaussianHmm } from './regime-hmm.js';
import { type RegimeInputs, RegimeService } from './regime.js';

function clusteredData(rows: number): number[][] {
  const centers = [
    [-1.2, 0.4, -0.8, 0.3],
    [0.1, -0.2, 0.2, -0.1],
    [1.5, -0.9, 1.1, 0.6],
  ];
  return Array.from({ length: rows }, (_, i) => {
    const c = centers[Math.floor(i / 50) % 3]!;
    return c.map((v, k) => v + 0.05 * Math.sin(i * (k + 1) * 0.7));
  });
}

describe('worker fit protocol', () => {
  it('packs and unpacks observations losslessly', () => {
    const data = clusteredData(37);
    expect(unpackObservations(packObservations(data), 37, 4)).toEqual(data);
  });

  it('a fit through the request path equals an in-process fit', () => {
    const data = clusteredData(600);
    const opts = { nStates: 3, seed: 42, maxIter: 40, tol: 1e-5 };
    const request: FitRequest = { values: packObservations(data), rows: 600, cols: 4, opts };
    const response = runFitRequest(request);
    expect(response).toEqual({ ok: true, result: fitGaussianHmm(data, opts) });
  });

  it('reports fit errors as values instead of throwing', () => {
    const response = runFitRequest({
      values: packObservations([[1, 2]]),
      rows: 1,
      cols: 2,
      opts: { nStates: 3 },
    });
    expect(response.ok).toBe(false);
  });
});

describe('RegimeService with an asynchronous fitter', () => {
  const startTs = 1_700_000_000_000;
  const inputAt = (i: number): RegimeInputs => {
    const level = [0.4, 0.6, 0.95][Math.floor(i / 100) % 3]!;
    return {
      ts: startTs + i * 300_000,
      atmIv30d: level + 0.01 * Math.sin(i * 0.7),
      rr25d_30d: -0.02 + 0.003 * Math.sin(i * 1.1),
      bfly25d_30d: 0.012 + 0.001 * Math.sin(i * 0.3),
      basis30d: 0.008 + 0.001 * Math.sin(i * 0.5),
    };
  };

  it('keeps snapshotting while a fit is pending and never starts a second fit', async () => {
    let cursor = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let fits = 0;
    const slowFitter: HmmFitter = async (data, opts) => {
      fits += 1;
      await gate;
      return inProcessHmmFitter(data, opts);
    };
    const svc = new RegimeService(
      { underlyings: ['BTC'], getRegimeInputs: async () => inputAt(cursor++) },
      { minSamplesToFit: 200, nStates: 3, seed: 7, maxFitIter: 30, fitHmm: slowFitter },
    );
    for (let i = 0; i < 199; i++) await svc.snapshotOnce();
    const pending = svc.snapshotOnce();
    await new Promise((resolve) => setImmediate(resolve));
    expect(fits).toBe(1);

    const concurrent = svc.snapshotOnce();
    await new Promise((resolve) => setImmediate(resolve));
    expect(fits).toBe(1);

    release();
    await Promise.all([pending, concurrent]);
    const result = svc.query('BTC');
    expect(fits).toBe(1);
    expect(result.posterior).toHaveLength(3);
    expect(result.stateLabels).not.toBeNull();
  });

  it('a failed fit leaves the service usable and retries on a later snapshot', async () => {
    let cursor = 0;
    let attempts = 0;
    const flaky: HmmFitter = async (data, opts) => {
      attempts += 1;
      if (attempts === 1) throw new Error('worker crashed');
      return inProcessHmmFitter(data, opts);
    };
    const svc = new RegimeService(
      { underlyings: ['BTC'], getRegimeInputs: async () => inputAt(cursor++) },
      { minSamplesToFit: 200, nStates: 3, seed: 7, maxFitIter: 30, fitHmm: flaky },
    );
    for (let i = 0; i < 200; i++) await svc.snapshotOnce();
    expect(svc.query('BTC').posterior).toBeNull();
    await svc.snapshotOnce();
    expect(attempts).toBe(2);
    expect(svc.query('BTC').posterior).toHaveLength(3);
  });
});
