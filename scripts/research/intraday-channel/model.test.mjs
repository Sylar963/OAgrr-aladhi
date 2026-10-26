import assert from 'node:assert/strict';
import test from 'node:test';
import { BAR_MS, PARAMETERS, backtest, channel, summarize, touchCounts } from './model.mjs';

const candle = (i, open, high, low, close) => ({ timestamp: i * BAR_MS, open, high, low, close });
const band = { middle: 100, lower: 96, upper: 104, atr: 1 };
const signal = candle(0, 97, 98, 95, 97);
const settings = { ...PARAMETERS, holdBars: 1 };

test('bands use prior completed candles, including true range across gaps', () => {
  const candles = [candle(0, 100, 101, 99, 100), candle(1, 110, 111, 109, 110), candle(2, 110, 112, 108, 111)];
  const before = channel(candles, { length: 2, multiplier: 4 });
  assert.deepEqual(before[2], { middle: 105, atr: 6.5, lower: 79, upper: 131 });
  candles[2] = candle(2, 110, 1000, 1, 999);
  assert.deepEqual(channel(candles, { length: 2, multiplier: 4 })[2], before[2]);
});

test('entry is next open and a stop/target collision resolves to the stop', () => {
  const candles = [signal, candle(1, 98, 102, 93, 99)];
  const { trades } = backtest(candles, [band, band], 0, 2 * BAR_MS, settings);
  assert.equal(trades.length, 1);
  assert.equal(trades[0].entry, 98);
  assert.equal(trades[0].exit, 94.5);
  assert.equal(trades[0].reason, 'stop');
  assert.equal(trades[0].ambiguous, true);
});

test('a gap past the stop exits at the worse open, and an invalid entry gap is skipped', () => {
  const candles = [signal, candle(1, 97, 99, 96, 98), candle(2, 90, 92, 89, 91)];
  const result = backtest(candles, candles.map(() => band), 0, 3 * BAR_MS, { ...settings, holdBars: 2 });
  assert.equal(result.trades[0].exit, 90);
  assert.equal(result.trades[0].reason, 'stop_gap');
  const invalid = backtest([signal, candles[2]], [band, band], 0, 3 * BAR_MS, settings);
  assert.equal(invalid.trades.length, 0);
  assert.equal(invalid.skippedEntryGaps, 1);
});

test('one trade per excursion until a subsequent close reaches the middle', () => {
  const candles = [signal, candle(1, 97, 98, 96, 97), candle(2, 97, 98, 95, 97), candle(3, 97, 98, 96, 97), candle(4, 98, 101, 97, 100), candle(5, 97, 98, 95, 97), candle(6, 97, 98, 96, 97)];
  const { trades } = backtest(candles, candles.map(() => band), 0, 7 * BAR_MS, settings);
  assert.deepEqual(trades.map(t => t.entryTimestamp), [BAR_MS, 6 * BAR_MS]);
});

test('window endpoints exclude incomplete holds', () => {
  const candles = [signal, candle(1, 97, 98, 96, 97)];
  const result = backtest(candles, [band, band], 0, 2 * BAR_MS, { ...settings, holdBars: 12 });
  assert.equal(result.trades.length, 0);
  assert.equal(result.skippedEndOfWindow, 1);
});

test('a candle entirely below a boundary is not a boundary touch', () => {
  const candles = [candle(0, 90, 92, 89, 91)];
  assert.equal(touchCounts(candles, [band], 0, BAR_MS).lowerTouchBars, 0);
});

test('cost scenarios cannot manufacture an edge from flat price returns', () => {
  const trades = [{ entryTimestamp: 0, grossBps: 0, holdingBars: 1, reason: 'timeout', ambiguous: false }];
  const result = summarize(trades, 0, BAR_MS);
  assert.equal(result.costScenarios.find(s => s.roundTripBps === 9).meanBps, -9);
  assert.equal(result.winRateAfter9Bps, 0);
  assert.equal(result.closedTradeDrawdownBpsAfter9Bps, 9);
});
