import assert from 'node:assert/strict';
import test from 'node:test';
import { patternBacktest, patternSignals } from './patterns.mjs';
import { BAR_MS } from './model.mjs';

const candle = (i, open = 100, high = 101, low = 99, close = 100) => ({ timestamp: i * BAR_MS, open, high, low, close });
const bands = Array.from({ length: 50 }, () => ({ middle: 100, lower: 94, upper: 106, atr: 2 }));
function doubleBottom() {
  const data = Array.from({ length: 50 }, (_, i) => candle(i));
  data[27] = candle(27, 94, 95, 92, 94);
  data[28] = candle(28, 97, 100, 96, 99);
  data[32] = candle(32, 94, 95, 92.4, 93);
  data[33] = candle(33, 94, 97, 93, 96);
  data[34] = candle(34, 96, 98, 95, 97);
  data[35] = candle(35, 97, 101, 96, 100);
  return data;
}

test('equal lows require a second confirmed pivot and a recovery inside the boundary', () => {
  const signals = patternSignals(doubleBottom(), bands, 1, 'equal');
  assert.equal(signals[32], null);
  assert.equal(signals[33].firstPivot, 27);
  assert.equal(signals[33].secondPivot, 32);
  assert.equal(signals[33].stop, 91);
});

test('equal lows outside the ATR tolerance do not form a pattern', () => {
  const data = doubleBottom();
  data[32].low = 90;
  assert.equal(patternSignals(data, bands, 1, 'equal')[33], null);
});

test('V confirmation is causal and requires recovery after the extreme', () => {
  const data = Array.from({ length: 50 }, (_, i) => candle(i));
  data[29] = candle(29, 96, 97, 90, 91);
  data[30] = candle(30, 91, 94, 91, 93);
  data[31] = candle(31, 93, 97, 93, 96);
  const signals = patternSignals(data, bands, 1, 'v');
  assert.equal(signals[29], null);
  assert.equal(signals[31].firstPivot, 29);
  assert.deepEqual(patternSignals(data.slice(0, 32), bands.slice(0, 32), 1, 'v'), signals.slice(0, 32));
});

test('mirrored equal highs produce short entries and positive returns on a decline', () => {
  const data = doubleBottom().map(c => ({ ...c, open: 200 - c.open, high: 200 - c.low, low: 200 - c.high, close: 200 - c.close }));
  const signals = patternSignals(data, bands, -1, 'equal');
  assert.ok(signals[33]);
  const trades = patternBacktest(data, bands, signals, 0, 50 * BAR_MS, { side: -1, target: 'middle', holdBars: 12 });
  assert.equal(trades[0].entryTimestamp, 34 * BAR_MS);
  assert.equal(trades[0].entry, 104);
  assert.equal(trades[0].exit, 100);
  assert.ok(trades[0].grossBps > 0);
  assert.ok(trades[0].stop > trades[0].entry);
});

test('a pattern is not counted as multiple trades during the same excursion', () => {
  const data = doubleBottom();
  const signals = patternSignals(data, bands, 1, 'equal');
  signals[36] = signals[33];
  const trades = patternBacktest(data, bands, signals, 0, 50 * BAR_MS, { side: 1, target: 'middle', holdBars: 12 });
  assert.equal(trades.length, 1);
});
