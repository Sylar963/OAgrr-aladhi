import { BAR_MS } from './model.mjs';

export const PATTERN_RULES = Object.freeze({ vLegBars: 6, vMinDropAtr: 2, vRecoveryFraction: 0.5, pivotMinBars: 3, pivotMaxBars: 24, equalToleranceAtr: 0.35, boundaryToleranceAtr: 0.25, pivotBounceAtr: 1, stopAtr: 0.5 });

export function orientedCandles(candles, side) {
  return candles.map(c => ({
    timestamp: c.timestamp, open: side * c.open, close: side * c.close,
    high: side === 1 ? c.high : -c.low, low: side === 1 ? c.low : -c.high,
  }));
}

export function patternSignals(candles, bands, side, kind) {
  const bars = orientedCandles(candles, side);
  const levels = bands.map(b => b && ({
    middle: side * b.middle, atr: b.atr,
    lower: side === 1 ? b.lower : -b.upper,
    upper: side === 1 ? b.upper : -b.lower,
  }));
  const signals = Array(candles.length).fill(null);
  const r = PATTERN_RULES;
  for (let i = r.pivotMaxBars + 2; i < bars.length; i++) {
    const c = bars[i];
    const b = levels[i];
    if (!b || !(b.atr > 0) || !(c.close > b.lower && c.close < b.upper)) continue;
    if (kind === 'v') {
      let extreme = i;
      for (let j = i - r.vLegBars; j < i; j++) if (bars[j].low < bars[extreme].low) extreme = j;
      if (extreme === i || !levels[extreme] || bars[extreme].low >= levels[extreme].lower) continue;
      const peak = Math.max(...bars.slice(extreme - r.vLegBars, extreme).map(bar => bar.high));
      const drop = peak - bars[extreme].low;
      if (drop < r.vMinDropAtr * b.atr || c.close - bars[extreme].low < r.vRecoveryFraction * drop) continue;
      signals[i] = { id: `v:${extreme}`, stop: bars[extreme].low - r.stopAtr * b.atr, middle: b.middle, opposite: b.upper, firstPivot: extreme, secondPivot: null };
    } else if (kind === 'equal') {
      const second = i - 1;
      if (!(bars[second].low < bars[second - 1].low && bars[second].low <= c.low && c.close > bars[second].high)) continue;
      if (!levels[second] || bars[second].low > levels[second].lower + r.boundaryToleranceAtr * b.atr) continue;
      for (let first = second - r.pivotMinBars; first >= second - r.pivotMaxBars; first--) {
        if (!levels[first] || !(bars[first].low < bars[first - 1].low && bars[first].low <= bars[first + 1].low)) continue;
        if (bars[first].low > levels[first].lower + r.boundaryToleranceAtr * b.atr) continue;
        if (Math.abs(bars[first].low - bars[second].low) > r.equalToleranceAtr * b.atr) continue;
        const bounce = Math.max(...bars.slice(first + 1, second).map(bar => bar.high)) - Math.max(bars[first].low, bars[second].low);
        if (bounce < r.pivotBounceAtr * b.atr) continue;
        signals[i] = { id: `equal:${first}:${second}`, stop: Math.min(bars[first].low, bars[second].low) - r.stopAtr * b.atr, middle: b.middle, opposite: b.upper, firstPivot: first, secondPivot: second };
        break;
      }
    } else {
      throw new Error(`Unknown pattern: ${kind}`);
    }
  }
  return signals;
}

export function patternBacktest(candles, bands, signals, from, to, config) {
  const bars = orientedCandles(candles, config.side);
  const trades = [];
  const used = new Set();
  let armed = true;
  for (let i = 0; i < bars.length - 1; i++) {
    const c = bars[i];
    if (c.timestamp < from || c.timestamp >= to || !bands[i]) continue;
    if (!armed) {
      if (c.close >= config.side * bands[i].middle) armed = true;
      continue;
    }
    const signal = signals[i];
    if (!signal || used.has(signal.id)) continue;
    used.add(signal.id);
    armed = false;
    const entryIndex = i + 1;
    const lastIndex = entryIndex + config.holdBars - 1;
    if (!bars[lastIndex] || bars[lastIndex].timestamp + BAR_MS > to) continue;
    const entry = bars[entryIndex].open;
    const stop = signal.stop;
    const target = signal[config.target];
    if (!(entry > stop && entry < target)) continue;
    for (let j = entryIndex; j <= lastIndex; j++) {
      const bar = bars[j];
      const ambiguous = bar.open > stop && bar.open < target && bar.low <= stop && bar.high >= target;
      let exit = null;
      let reason = null;
      if (bar.open <= stop) { exit = bar.open; reason = 'stop_gap'; }
      else if (bar.open >= target) { exit = target; reason = 'target'; }
      else if (bar.low <= stop) { exit = stop; reason = 'stop'; }
      else if (bar.high >= target) { exit = target; reason = 'target'; }
      else if (j === lastIndex) { exit = bar.close; reason = 'timeout'; }
      if (exit == null) continue;
      const rawEntry = config.side * entry;
      const rawExit = config.side * exit;
      trades.push({
        entryTimestamp: bars[entryIndex].timestamp, exitBarTimestamp: bar.timestamp,
        signalTimestamp: c.timestamp + BAR_MS, signalId: signal.id,
        entry: rawEntry, exit: rawExit, stop: config.side * stop, target: config.side * target,
        grossBps: config.side * (rawExit / rawEntry - 1) * 10_000,
        reason, ambiguous, holdingBars: j - entryIndex + 1,
      });
      i = j;
      break;
    }
  }
  return trades;
}
