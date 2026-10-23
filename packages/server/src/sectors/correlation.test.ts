import type { PerpCandle, PerpCandleSnapshot } from '@oggregator/core';
import { CryptoSectorCorrelationResponseSchema } from '@oggregator/protocol';
import { describe, expect, it } from 'vitest';
import type { SectorBasketDef } from './baskets.js';
import {
  buildSectorCorrelation,
  type CorrelationWindowCache,
  correlationSymbols,
} from './correlation.js';

const BAR = 300_000;
// Saturday 2026-10-24 00:00 UTC, so a 300-bar history ending here starts Friday ~23:00 ET.
const LAST = Date.UTC(2026, 9, 24, 0, 0) - BAR;

const baskets: SectorBasketDef[] = [
  { id: 'a', name: 'A', members: ['A1', 'A2'] },
  { id: 'b', name: 'B', members: ['B1', 'B2'] },
  { id: 'c', name: 'C', members: ['C1', 'C2'] },
  { id: 'd', name: 'D', members: ['D1', 'D2'] },
];

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1_664_525 + 1_013_904_223) % 2 ** 32;
    return s / 2 ** 32 - 0.5;
  };
}

/** Closes driven by `common` (shared) plus idiosyncratic noise of weight 1 - common; BTC is the pure driver. */
function snapshot(
  bars: number,
  common: (i: number, sym: string) => number,
  seed = 1,
): PerpCandleSnapshot {
  const noise = rng(seed);
  const factor = Array.from({ length: bars }, () => noise());
  const series = new Map<string, PerpCandle[]>();
  for (const sym of correlationSymbols(baskets)) {
    let close = 100;
    const list: PerpCandle[] = [];
    for (let i = 0; i < bars; i++) {
      const w = sym === 'BTCUSDT' ? 1 : common(i, sym);
      close *= Math.exp(0.002 * (w * factor[i]! + (1 - w) * noise()));
      list.push({ start: LAST - (bars - 1 - i) * BAR, close, volume: 1 });
    }
    series.set(sym, list);
  }
  return { barMs: BAR, lastClosedStart: LAST, series };
}

describe('buildSectorCorrelation', () => {
  it('reads a common driver as correlated and noise as dispersed, with a schema-valid body', () => {
    const together = buildSectorCorrelation({ snapshot: snapshot(400, () => 1), baskets });
    CryptoSectorCorrelationResponseSchema.parse(together);
    expect(together.current!.avgCorr).toBeGreaterThan(0.99);
    expect(together.current!.pc1Share).toBeGreaterThan(0.99);
    expect(together.regime).toBe('correlated');
    expect(together.sectors[0]!.corrBtc).toBeGreaterThan(0.99);
    expect(together.views.map((v) => v.windowBars)).toEqual([24, 72, 288]);
    expect(together.views[2]!.matrix[1]![2]).toBeGreaterThan(0.99);
    expect(together.views[0]!.corrBtc[3]).toBeGreaterThan(0.99);
    expect(together.timeline).toHaveLength(288);
    expect(together.asOf).toBe(LAST + BAR);
    expect(together.timeline.at(-1)!.t).toBe(LAST + BAR);

    const apart = buildSectorCorrelation({ snapshot: snapshot(300, () => 0), baskets });
    expect(Math.abs(apart.current!.avgCorr!)).toBeLessThan(0.4);
    expect(apart.regime).toBe('dispersed');
  });

  it('dates the regime from when correlation took over and reports the hourly change', () => {
    const body = buildSectorCorrelation({
      snapshot: snapshot(300, (i) => (i < 200 ? 0 : 1)),
      baskets,
    });
    expect(body.regime).toBe('correlated');
    const since = (body.regimeSince! - (LAST - 299 * BAR)) / BAR;
    expect(since).toBeGreaterThan(200);
    expect(since).toBeLessThan(200 + 24);
    expect(body.zScore).toBeGreaterThan(0);
  });

  it('removes BTC: sectors driven only by BTC have low residual correlation', () => {
    const body = buildSectorCorrelation({ snapshot: snapshot(300, () => 0.9), baskets });
    expect(body.current!.avgCorr).toBeGreaterThan(0.9);
    expect(Math.abs(body.current!.residualCorr!)).toBeLessThan(0.5);
  });

  it('flags only the sector that breaks from a correlated pack', () => {
    const body = buildSectorCorrelation({
      snapshot: snapshot(400, (i, sym) => (i >= 376 && sym.startsWith('D') ? 0 : 0.8)),
      baskets,
    });
    expect(body.regime).not.toBe('dispersed');
    const d = body.sectors.find((x) => x.id === 'd')!;
    expect(d.decoupled).toBe(true);
    expect(d.gapZ!).toBeLessThan(-2);
    expect(body.sectors.filter((x) => x.decoupled).map((x) => x.id)).toEqual(['d']);
  });

  it('builds a BTC-removed matrix next to the raw one', () => {
    const body = buildSectorCorrelation({ snapshot: snapshot(400, () => 0.9), baskets });
    const view = body.views[0]!;
    expect(view.matrix[0]![1]).toBeGreaterThan(0.9);
    expect(Math.abs(view.residualMatrix[0]![1]!)).toBeLessThan(0.5);
    expect(view.residualMatrix[2]![2]).toBe(1);
  });

  it('serves identical results from the window cache', () => {
    const snap = snapshot(300, (i) => (i % 50) / 50);
    const cache: CorrelationWindowCache = new Map();
    const cold = buildSectorCorrelation({ snapshot: snap, baskets, cache });
    const warm = buildSectorCorrelation({ snapshot: snap, baskets, cache });
    expect(warm).toEqual(cold);
    expect(warm).toEqual(buildSectorCorrelation({ snapshot: snap, baskets }));
  });

  it('ignores US equity perps outside NYSE hours', () => {
    const stocks: SectorBasketDef[] = [
      ...baskets.slice(0, 3),
      { id: 'eq', name: 'EQ', members: [{ symbol: 'SPY', bybit: 'A1USDT', session: 'us-equity' }] },
    ];
    const body = buildSectorCorrelation({ snapshot: snapshot(300, () => 1), baskets: stocks });
    expect(body.sectors.find((s) => s.id === 'eq')!.corrBtc).toBeNull();
    expect(body.views[0]!.matrix[3]!.every((v) => v == null)).toBe(true);
    expect(body.current!.avgCorr).toBeGreaterThan(0.99);
  });

  it('returns an empty, schema-valid body with no candles', () => {
    const body = buildSectorCorrelation({
      snapshot: { barMs: BAR, lastClosedStart: LAST, series: new Map() },
      baskets,
    });
    CryptoSectorCorrelationResponseSchema.parse(body);
    expect(body.current).toBeNull();
    expect(body.regime).toBeNull();
    expect(body.timeline).toEqual([]);
  });
});
