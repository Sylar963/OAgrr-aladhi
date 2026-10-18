import { describe, expect, it } from 'vitest';
import { price76, vega76 } from '../../feeds/thalex/bs-solver.js';
import { VolHeatmapEngine } from './engine.js';
import type { HeatmapInstrument } from './select.js';

const NOW = Date.UTC(2026, 9, 17, 12);
const EXPIRY = Date.UTC(2026, 10, 27, 8);
const T = (EXPIRY - NOW) / (365 * 86_400_000);
const F = 81_700;
const CALL: HeatmapInstrument = { name: 'BTC-27NOV26-82000-C', strike: 82_000, right: 'call', expiry: EXPIRY };
const PUT: HeatmapInstrument = { name: 'BTC-27NOV26-80000-P', strike: 80_000, right: 'put', expiry: EXPIRY };

/** Premium in BTC that prices `inst` at `iv`. */
const btcPrice = (inst: HeatmapInstrument, iv: number) =>
  price76(F, inst.strike, iv, T, inst.right) / F;
const vegaPerPoint = (inst: HeatmapInstrument, iv: number, amount: number) =>
  (amount * vega76(F, inst.strike, iv, T)) / 100;

function engineWith(...instruments: HeatmapInstrument[]): VolHeatmapEngine {
  const engine = new VolHeatmapEngine(0.0025);
  engine.setInstruments(instruments);
  engine.applyForward(EXPIRY, F);
  return engine;
}

describe('VolHeatmapEngine', () => {
  it('places each book level in its IV bucket weighted by amount × vega', () => {
    const engine = engineWith(CALL);
    engine.applyBook(CALL.name, [[btcPrice(CALL, 0.36), 10]], [[btcPrice(CALL, 0.38), 4]]);
    engine.sample(NOW);
    const column = engine.flush(NOW);

    expect(column.cells).toEqual([
      [144, Math.round(vegaPerPoint(CALL, 0.36, 10)), 0],
      [152, 0, Math.round(vegaPerPoint(CALL, 0.38, 4))],
    ]);
  });

  it('sums instruments landing in the same bucket and averages across samples', () => {
    const engine = engineWith(CALL, PUT);
    engine.applyBook(CALL.name, [[btcPrice(CALL, 0.37), 10]], []);
    engine.applyBook(PUT.name, [[btcPrice(PUT, 0.37), 6]], []);
    engine.sample(NOW);
    engine.applyBook(PUT.name, [], []);
    engine.sample(NOW + 1_000);
    const column = engine.flush(NOW);

    const expected = (vegaPerPoint(CALL, 0.37, 10) * 2 + vegaPerPoint(PUT, 0.37, 6)) / 2;
    expect(column.cells).toEqual([[148, Math.round(expected), 0]]);
  });

  it('skips levels that cannot be inverted and books with no forward yet', () => {
    const engine = new VolHeatmapEngine(0.0025);
    engine.setInstruments([CALL]);
    engine.applyBook(CALL.name, [[btcPrice(CALL, 0.36), 10]], []);
    engine.sample(NOW);
    expect(engine.flush(NOW).cells).toEqual([]);

    engine.applyForward(EXPIRY, F);
    // Below intrinsic for a deep ITM strike is unsolvable; above the forward too.
    engine.applyBook(CALL.name, [[0.000001, 5]], [[1.5, 5]]);
    engine.sample(NOW);
    expect(engine.flush(NOW).cells).toEqual([]);
  });

  it('ignores books for unselected instruments and drops them on reselection', () => {
    const engine = engineWith(CALL);
    engine.applyBook(PUT.name, [[btcPrice(PUT, 0.37), 6]], []);
    engine.applyBook(CALL.name, [[btcPrice(CALL, 0.37), 6]], []);
    engine.setInstruments([PUT]);
    engine.sample(NOW);
    expect(engine.flush(NOW).cells).toEqual([]);
  });

  it('records trades with the venue IV, or solves one from the premium', () => {
    const engine = engineWith(CALL);
    engine.addTrade({ t: NOW, instrument: CALL.name, side: 'buy', price: 0.05, amount: 2, iv: 0.4 });
    engine.addTrade({
      t: NOW,
      instrument: CALL.name,
      side: 'sell',
      price: btcPrice(CALL, 0.35),
      amount: 1,
      iv: null,
    });
    engine.addTrade({ t: NOW, instrument: 'BTC-OTHER', side: 'buy', price: 0.05, amount: 2, iv: 0.4 });
    const { trades } = engine.flush(NOW);

    expect(trades).toHaveLength(2);
    expect(trades[0]).toMatchObject({ side: 'buy', iv: 0.4, amount: 2 });
    expect(trades[0]!.vega).toBeCloseTo(vegaPerPoint(CALL, 0.4, 2), 1);
    expect(trades[1]!.iv).toBeCloseTo(0.35, 6);
  });

  it('resets accumulators on flush but keeps the last DVOL', () => {
    const engine = engineWith(CALL);
    engine.applyDvol(0.375);
    engine.applyBook(CALL.name, [[btcPrice(CALL, 0.36), 10]], []);
    engine.sample(NOW);
    engine.flush(NOW);
    engine.clearBooks();
    engine.sample(NOW + 15_000);

    expect(engine.flush(NOW + 15_000)).toEqual({
      t: NOW + 15_000,
      dvol: 0.375,
      cells: [],
      adjCells: [],
      atmMid: null,
      trades: [],
    });
  });
});

describe('VolHeatmapEngine skew adjustment', () => {
  const NEAR = Date.UTC(2026, 10, 6, 8);
  const T_NEAR = (NEAR - NOW) / (365 * 86_400_000);
  const nearAtm: HeatmapInstrument = { name: 'BTC-6NOV26-82000-C', strike: 82_000, right: 'call', expiry: NEAR };
  const nearPrice = (iv: number) => price76(F, nearAtm.strike, iv, T_NEAR, 'call') / F;

  it('places each level at its distance from its own mid, re-centred on the ATM mid', () => {
    // The put trades 4 vols over the ATM call (skew); adjusted, both books share one centre.
    const engine = engineWith(CALL, PUT);
    engine.setInstruments([CALL, PUT], new Map([[EXPIRY, CALL.name]]));
    engine.applyBook(CALL.name, [[btcPrice(CALL, 0.355), 10]], [[btcPrice(CALL, 0.365), 10]]);
    engine.applyBook(PUT.name, [[btcPrice(PUT, 0.39), 6]], [[btcPrice(PUT, 0.41), 6]]);
    engine.sample(NOW);
    const column = engine.flush(NOW);

    expect(column.atmMid).toBeCloseTo(0.36, 6);
    expect(column.cells.map(([b]) => b)).toEqual([142, 146, 156, 164]);
    // Put: 0.39 − 0.40 + 0.36 = 0.35 → 140, 0.41 − 0.40 + 0.36 = 0.37 → 148.
    expect(column.adjCells.map(([b, bid, ask]) => [b, bid > 0, ask > 0])).toEqual([
      [140, true, false],
      [142, true, false],
      [146, false, true],
      [148, false, true],
    ]);
  });

  it('interpolates the anchor to 30 days in total variance across the two expiries', () => {
    const engine = engineWith(CALL, nearAtm);
    engine.applyForward(NEAR, F);
    engine.setInstruments([CALL, nearAtm], new Map([[EXPIRY, CALL.name], [NEAR, nearAtm.name]]));
    engine.applyBook(CALL.name, [[btcPrice(CALL, 0.39), 1]], [[btcPrice(CALL, 0.41), 1]]);
    engine.applyBook(nearAtm.name, [[nearPrice(0.34), 1]], [[nearPrice(0.36), 1]]);
    engine.sample(NOW);

    const t30 = 30 / 365;
    const w = 0.35 ** 2 * T_NEAR + ((0.4 ** 2 * T - 0.35 ** 2 * T_NEAR) * (t30 - T_NEAR)) / (T - T_NEAR);
    expect(engine.flush(NOW).atmMid).toBeCloseTo(Math.sqrt(w / t30), 6);
  });

  it('leaves one-sided books out of the adjusted view and tags trades with an adjusted IV', () => {
    const engine = engineWith(CALL, PUT);
    engine.setInstruments([CALL, PUT], new Map([[EXPIRY, CALL.name]]));
    engine.applyBook(CALL.name, [[btcPrice(CALL, 0.355), 10]], [[btcPrice(CALL, 0.365), 10]]);
    engine.applyBook(PUT.name, [[btcPrice(PUT, 0.39), 6]], []);
    engine.sample(NOW);
    engine.addTrade({ t: NOW, instrument: CALL.name, side: 'buy', price: 0, amount: 1, iv: 0.37 });
    engine.addTrade({ t: NOW, instrument: PUT.name, side: 'sell', price: 0, amount: 1, iv: 0.4 });
    const column = engine.flush(NOW);

    expect(column.cells.some(([b]) => b === 156)).toBe(true);
    expect(column.adjCells.map(([b]) => b)).toEqual([142, 146]);
    expect(column.trades[0]!.adjIv).toBeCloseTo(0.37, 6);
    expect(column.trades[1]!.adjIv).toBeNull();
  });
});
