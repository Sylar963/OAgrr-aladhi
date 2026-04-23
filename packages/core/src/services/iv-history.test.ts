import { describe, expect, it, vi } from 'vitest';
import { interpTenor, type IvSurfaceRow } from '../core/enrichment.js';
import { IvHistoryService } from './iv-history.js';
import type { DvolService } from './dvol.js';

function makeRow(expiry: string, dte: number, atm: number, skew: number, fly: number): IvSurfaceRow {
  // skew = c25 − p25, fly = (c25+p25)/2 − atm → solve for c25, p25
  // c25 = atm + fly + skew/2; p25 = atm + fly − skew/2.
  const c25 = atm + fly + skew / 2;
  const p25 = atm + fly - skew / 2;
  return {
    expiry,
    dte,
    delta10p: null,
    delta25p: p25,
    atm,
    delta25c: c25,
    delta10c: null,
  };
}

function mockDvol(history: { BTC?: Array<[number, number]>; ETH?: Array<[number, number]> } = {}) {
  const getHistory = (currency: string) => {
    const rows = history[currency as 'BTC' | 'ETH'] ?? [];
    return rows.map(([timestamp, close]) => ({
      timestamp,
      open: close,
      high: close,
      low: close,
      close,
    }));
  };
  return { getHistory } as unknown as DvolService;
}

describe('interpTenor', () => {
  it('variance-time interpolates ATM between two expiries', () => {
    const surfaces: IvSurfaceRow[] = [
      makeRow('near', 14, 0.5, 0, 0),
      makeRow('far', 60, 0.6, 0, 0),
    ];
    const at30 = interpTenor(surfaces, 30, 'atm');
    expect(at30).not.toBeNull();
    // Manually: vLo = 0.25 * 14 = 3.5; vHi = 0.36 * 60 = 21.6; t = 16/46.
    const t = 16 / 46;
    const vInterp = 3.5 + t * (21.6 - 3.5);
    const expected = Math.sqrt(vInterp / 30);
    expect(at30!).toBeCloseTo(expected, 6);
  });

  it('clamps to nearest endpoint outside observed DTE range', () => {
    const surfaces: IvSurfaceRow[] = [
      makeRow('near', 7, 0.5, 0, 0),
      makeRow('far', 30, 0.6, 0, 0),
    ];
    expect(interpTenor(surfaces, 3, 'atm')).toBe(0.5);
    expect(interpTenor(surfaces, 60, 'atm')).toBe(0.6);
  });

  it('returns null when no surface rows have the requested field', () => {
    const surfaces: IvSurfaceRow[] = [
      { expiry: 'x', dte: 10, delta10p: null, delta25p: null, atm: null, delta25c: null, delta10c: null },
    ];
    expect(interpTenor(surfaces, 30, 'atm')).toBeNull();
  });
});

describe('IvHistoryService', () => {
  it('evicts oldest when exceeding capacity', async () => {
    const surfaces = [makeRow('e', 30, 0.5, 0.02, 0.01)];
    const svc = new IvHistoryService(
      {
        getSurfaceGrid: () => Promise.resolve(surfaces),
        dvol: mockDvol(),
      },
      { underlyings: ['BTC'], intervalMs: 10_000, capacity: 3 },
    );
    for (let i = 0; i < 5; i++) {
      await svc.snapshotOnce(1000 + i);
    }
    const buf = svc.getBuffer('BTC', '30d');
    expect(buf).toHaveLength(3);
    expect(buf[0]!.ts).toBe(1002);
    expect(buf[2]!.ts).toBe(1004);
    svc.dispose();
  });

  it('computes rank and percentile from a fixed fixture', async () => {
    // ATM IV values: 0.40, 0.50, 0.60, 0.70 — latest is 0.70 (richest).
    const svc = new IvHistoryService(
      {
        getSurfaceGrid: vi.fn(),
        dvol: mockDvol(),
      },
      { underlyings: ['BTC'], capacity: 100 },
    );
    const now = Date.now();
    const days = 24 * 3600 * 1000;
    for (let i = 0; i < 4; i++) {
      // snapshotOnce uses the interp on surfaces; we bypass by directly pushing via public API
      // using snapshotOnce with custom surfaces. Simpler: craft surfaces per iv step.
    }
    // Push by calling snapshotOnce with varying surfaces.
    const vols = [0.4, 0.5, 0.6, 0.7];
    for (let i = 0; i < vols.length; i++) {
      (svc as unknown as { deps: { getSurfaceGrid: (u: string) => Promise<IvSurfaceRow[]> } }).deps.getSurfaceGrid =
        () => Promise.resolve([makeRow('e', 30, vols[i]!, 0, 0)]);
      await svc.snapshotOnce(now - (vols.length - 1 - i) * days);
    }
    const res = svc.query('BTC', 30);
    const t30 = res.tenors['30d'];
    expect(t30.current.atmIv).toBeCloseTo(0.7, 6);
    expect(t30.min.atmIv).toBeCloseTo(0.4, 6);
    expect(t30.max.atmIv).toBeCloseTo(0.7, 6);
    // rank = (0.7 − 0.4) / (0.7 − 0.4) × 100 = 100.
    expect(t30.atmRank).toBeCloseTo(100, 6);
    // percentile = 4/4 × 100 = 100 (current is the max and counts itself).
    expect(t30.atmPercentile).toBeCloseTo(100, 6);
    svc.dispose();
  });

  it('seeds the 30d buffer from DvolService on start', async () => {
    const now = Date.now();
    const svc = new IvHistoryService(
      {
        getSurfaceGrid: () => Promise.resolve([]), // no live surface → snapshotOnce is a no-op
        dvol: mockDvol({
          BTC: [
            [now - 2 * 24 * 3600 * 1000, 50],
            [now - 24 * 3600 * 1000, 55],
            [now, 60],
          ],
        }),
      },
      { underlyings: ['BTC', 'ETH'], intervalMs: 60_000 },
    );
    await svc.start();
    const btc30 = svc.getBuffer('BTC', '30d');
    expect(btc30).toHaveLength(3);
    expect(btc30[0]!.atmIv).toBeCloseTo(0.5, 6);
    expect(btc30[2]!.atmIv).toBeCloseTo(0.6, 6);
    expect(btc30[0]!.rr25d).toBeNull();
    expect(btc30[0]!.bfly25d).toBeNull();

    expect(svc.getBuffer('BTC', '7d')).toHaveLength(0);
    expect(svc.getBuffer('BTC', '60d')).toHaveLength(0);
    expect(svc.getBuffer('BTC', '90d')).toHaveLength(0);
    expect(svc.getBuffer('ETH', '30d')).toHaveLength(0);
    svc.dispose();
  });

  it('computes RR and butterfly from per-tenor snapshots', async () => {
    // skew = +0.04 → RR at 30d should be +0.04; fly = +0.01.
    const surfaces = [makeRow('e', 30, 0.5, 0.04, 0.01)];
    const svc = new IvHistoryService(
      {
        getSurfaceGrid: () => Promise.resolve(surfaces),
        dvol: mockDvol(),
      },
      { underlyings: ['BTC'] },
    );
    await svc.snapshotOnce(Date.now());
    const buf = svc.getBuffer('BTC', '30d');
    expect(buf).toHaveLength(1);
    expect(buf[0]!.rr25d).toBeCloseTo(0.04, 6);
    expect(buf[0]!.bfly25d).toBeCloseTo(0.01, 6);
    svc.dispose();
  });
});
