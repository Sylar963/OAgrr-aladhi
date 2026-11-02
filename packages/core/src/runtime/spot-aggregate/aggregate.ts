export interface VenueBar {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface AggregatedBar extends VenueBar {
  venues: number;
}

export interface WeightedBar {
  bar: VenueBar;
  weight: number;
}

/**
 * The middle of the weighted distribution, averaging the two neighbours when the
 * cumulative weight lands exactly on half.
 */
export function weightedMedian(entries: readonly { value: number; weight: number }[]): number {
  const sorted = [...entries].sort((a, b) => a.value - b.value);
  const half = sorted.reduce((sum, entry) => sum + entry.weight, 0) / 2;
  let cumulative = 0;
  for (let i = 0; i < sorted.length; i++) {
    cumulative += sorted[i]!.weight;
    if (cumulative > half) return sorted[i]!.value;
    if (cumulative === half) return (sorted[i]!.value + sorted[i + 1]!.value) / 2;
  }
  throw new Error('weightedMedian needs at least one entry');
}

/**
 * One candle from every venue's bar in a bucket. Each OHLC field takes its own
 * weighted median, so one venue's bad print can't draw a wick. That keeps the bar
 * valid too: a venue's high is at least its open, low and close, so the same order
 * statistic of those fields keeps that ordering. Volume is the sum, in base asset.
 */
export function aggregateBars(timestamp: number, inputs: readonly WeightedBar[]): AggregatedBar | null {
  if (inputs.length === 0) return null;
  const median = (field: 'open' | 'high' | 'low' | 'close') =>
    weightedMedian(inputs.map(({ bar, weight }) => ({ value: bar[field], weight })));
  return {
    timestamp,
    open: median('open'),
    high: median('high'),
    low: median('low'),
    close: median('close'),
    volume: inputs.reduce((sum, { bar }) => sum + bar.volume, 0),
    venues: inputs.length,
  };
}

/** Combines ascending bars of one venue into a single wider bar. */
export function rollupBars(timestamp: number, bars: readonly VenueBar[]): VenueBar | null {
  const first = bars[0];
  const last = bars[bars.length - 1];
  if (!first || !last) return null;
  return {
    timestamp,
    open: first.open,
    high: Math.max(...bars.map((bar) => bar.high)),
    low: Math.min(...bars.map((bar) => bar.low)),
    close: last.close,
    volume: bars.reduce((sum, bar) => sum + bar.volume, 0),
  };
}

export function scaleBar(bar: VenueBar, rate: number): VenueBar {
  return {
    timestamp: bar.timestamp,
    open: bar.open * rate,
    high: bar.high * rate,
    low: bar.low * rate,
    close: bar.close * rate,
    volume: bar.volume,
  };
}

export function applyTick(
  existing: VenueBar | undefined,
  timestamp: number,
  price: number,
  size: number,
): VenueBar {
  if (!existing) {
    return { timestamp, open: price, high: price, low: price, close: price, volume: size };
  }
  return {
    timestamp,
    open: existing.open,
    high: Math.max(existing.high, price),
    low: Math.min(existing.low, price),
    close: price,
    volume: existing.volume + size,
  };
}

/**
 * A REST snapshot of the forming bar arrives behind the live stream, so it may
 * widen the range and supply the true open, but never moves the close backwards.
 */
export function mergeFormingBar(existing: VenueBar, rest: VenueBar): VenueBar {
  return {
    timestamp: rest.timestamp,
    open: rest.open,
    high: Math.max(existing.high, rest.high),
    low: Math.min(existing.low, rest.low),
    close: existing.close,
    volume: Math.max(existing.volume, rest.volume),
  };
}
