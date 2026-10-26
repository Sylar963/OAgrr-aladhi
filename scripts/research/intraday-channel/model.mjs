export const BAR_MS = 300_000;
export const PARAMETERS = Object.freeze({ length: 130, multiplier: 4, stopAtr: 0.5, holdBars: 12 });

export function channel(candles, { length, multiplier } = PARAMETERS) {
  const bands = [];
  let middle = null;
  let atr = null;
  let sumClose = 0;
  let sumRange = 0;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    bands.push(middle == null ? null : { middle, atr, lower: middle - multiplier * atr, upper: middle + multiplier * atr });
    const previousClose = candles[i - 1]?.close ?? c.open;
    const range = Math.max(c.high - c.low, Math.abs(c.high - previousClose), Math.abs(c.low - previousClose));
    if (i < length) {
      sumClose += c.close;
      sumRange += range;
      if (i === length - 1) {
        middle = sumClose / length;
        atr = sumRange / length;
      }
    } else {
      middle += 2 / (length + 1) * (c.close - middle);
      atr += (range - atr) / length;
    }
  }
  return bands;
}

export function touchCounts(candles, bands, from, to) {
  const days = new Map();
  let lowerBars = 0;
  let upperBars = 0;
  let reclaimBars = 0;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const b = bands[i];
    if (c.timestamp < from || c.timestamp >= to || !b) continue;
    const day = new Date(c.timestamp).toISOString().slice(0, 10);
    if (!days.has(day)) days.set(day, { lower: false, upper: false });
    const counts = days.get(day);
    if (c.low <= b.lower && c.high >= b.lower) {
      lowerBars++;
      counts.lower = true;
    }
    if (c.low <= b.upper && c.high >= b.upper) {
      upperBars++;
      counts.upper = true;
    }
    if (c.low < b.lower && c.close > b.lower && c.close < b.upper) reclaimBars++;
  }
  return {
    days: days.size,
    daysWithLowerTouch: [...days.values()].filter(d => d.lower).length,
    daysWithUpperTouch: [...days.values()].filter(d => d.upper).length,
    daysWithEitherTouch: [...days.values()].filter(d => d.lower || d.upper).length,
    lowerTouchBars: lowerBars,
    upperTouchBars: upperBars,
    lowerReclaimBars: reclaimBars,
  };
}

export function backtest(candles, bands, from, to, parameters = PARAMETERS) {
  const trades = [];
  let armed = true;
  let skippedEntryGaps = 0;
  let skippedEndOfWindow = 0;
  for (let i = 0; i < candles.length - 1; i++) {
    const c = candles[i];
    const b = bands[i];
    if (c.timestamp < from || c.timestamp >= to || !b) continue;
    if (!armed) {
      if (c.close >= b.middle) armed = true;
      continue;
    }
    if (!(c.low < b.lower && c.close > b.lower && c.close < b.upper)) continue;
    armed = false;
    const entryIndex = i + 1;
    const lastIndex = entryIndex + parameters.holdBars - 1;
    if (!candles[lastIndex] || candles[lastIndex].timestamp + BAR_MS > to) {
      skippedEndOfWindow++;
      continue;
    }
    const entry = candles[entryIndex].open;
    const stop = c.low - parameters.stopAtr * b.atr;
    const target = b.middle;
    if (entry <= stop || entry >= target || stop <= 0) {
      skippedEntryGaps++;
      continue;
    }
    for (let j = entryIndex; j <= lastIndex; j++) {
      const bar = candles[j];
      let exit = null;
      let reason = null;
      const ambiguous = bar.open > stop && bar.open < target && bar.low <= stop && bar.high >= target;
      if (bar.open <= stop) {
        exit = bar.open;
        reason = 'stop_gap';
      } else if (bar.open >= target) {
        exit = target;
        reason = 'target';
      } else if (bar.low <= stop) {
        // OHLC cannot resolve stop/target ordering; charge the stop when both are hit.
        exit = stop;
        reason = 'stop';
      } else if (bar.high >= target) {
        exit = target;
        reason = 'target';
      } else if (j === lastIndex) {
        exit = bar.close;
        reason = 'timeout';
      }
      if (exit == null) continue;
      trades.push({
        signalTimestamp: c.timestamp + BAR_MS,
        entryTimestamp: candles[entryIndex].timestamp,
        exitBarTimestamp: bar.timestamp,
        entry, exit, stop, target, lower: b.lower, atr: b.atr,
        reason, ambiguous, holdingBars: j - entryIndex + 1,
        grossBps: (exit / entry - 1) * 10_000,
      });
      i = j;
      break;
    }
  }
  return { trades, skippedEntryGaps, skippedEndOfWindow };
}

function quantile(sorted, p) {
  const position = (sorted.length - 1) * p;
  const low = Math.floor(position);
  return sorted[low] + (sorted[Math.ceil(position)] - sorted[low]) * (position - low);
}

export function summarize(trades, from, to) {
  if (!trades.length) return { trades: 0 };
  const gross = trades.map(t => t.grossBps);
  const net = gross.map(r => r - 9);
  const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
  let equity = 0;
  let peak = 0;
  let drawdown = 0;
  for (const value of net) {
    equity += value;
    peak = Math.max(peak, equity);
    drawdown = Math.max(drawdown, peak - equity);
  }
  const weekMs = 7 * 86_400_000;
  const weeks = Array.from({ length: Math.ceil((to - from) / weekMs) }, () => ({ sum: 0, count: 0 }));
  for (const trade of trades) {
    const week = weeks[Math.floor((trade.entryTimestamp - from) / weekMs)];
    week.sum += trade.grossBps - 9;
    week.count++;
  }
  let seed = 130004;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const bootstrap = [];
  for (let sample = 0; sample < 5000; sample++) {
    let sum = 0;
    let count = 0;
    for (let i = 0; i < weeks.length; i++) {
      const week = weeks[Math.floor(random() * weeks.length)];
      sum += week.sum;
      count += week.count;
    }
    if (count) bootstrap.push(sum / count);
  }
  bootstrap.sort((a, b) => a - b);
  const losses = net.filter(r => r < 0).reduce((sum, r) => sum - r, 0);
  return {
    trades: trades.length,
    grossMeanBps: mean(gross),
    costScenarios: [0, 7, 9, 14].map(roundTripBps => ({ roundTripBps, meanBps: mean(gross) - roundTripBps })),
    winRateAfter9Bps: net.filter(r => r > 0).length / net.length,
    profitFactorAfter9Bps: losses > 0 ? net.filter(r => r > 0).reduce((sum, r) => sum + r, 0) / losses : null,
    meanAfter9BpsWeekBootstrap95: [quantile(bootstrap, 0.025), quantile(bootstrap, 0.975)],
    calendarBlocks: weeks.length,
    closedTradeDrawdownBpsAfter9Bps: drawdown,
    worstTradeBpsAfter9Bps: Math.min(...net),
    medianHoldingMinutesUpperBound: quantile(trades.map(t => t.holdingBars * 5).sort((a, b) => a - b), 0.5),
    exits: Object.fromEntries(['target', 'stop', 'stop_gap', 'timeout'].map(reason => [reason, trades.filter(t => t.reason === reason).length])),
    ambiguousStopFirstTrades: trades.filter(t => t.ambiguous).length,
  };
}
