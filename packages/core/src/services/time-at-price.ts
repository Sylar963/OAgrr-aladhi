// Time-at-price profile from hourly OHLC: how many bars traded through each price level,
// plus the mean trailing Parkinson volatility of bars whose mid fell in each coarser bin.

export interface TimeAtPriceCandle {
  timestamp: number;
  high: number;
  low: number;
  close: number;
}

export interface TimeAtPriceLevel {
  /** Lower edge of the bin. */
  price: number;
  /** Bars whose low–high range contains `price`. */
  bars: number;
}

export interface VolByPriceLevel {
  /** Lower edge of the bin. */
  price: number;
  /** Mean trailing Parkinson vol, annualized fraction. */
  vol: number;
  /** Bars whose mid fell in the bin. */
  bars: number;
}

export interface TimeAtPriceOptions {
  /** Only bars at or after this ts are counted; earlier bars only warm up the vol window. */
  fromTs: number;
  volWindowBars: number;
  barsPerYear: number;
  targetLevels: number;
  targetVolBins: number;
}

export interface TimeAtPriceProfile {
  binSize: number;
  volBinSize: number;
  levels: TimeAtPriceLevel[];
  volByLevel: VolByPriceLevel[];
  dailyCloses: { ts: number; close: number }[];
  bars: number;
}

const DAY_MS = 86_400_000;
const PARKINSON_DENOM = 4 * Math.LN2;

/** Smallest 1/2/2.5/5 × 10^k step at or above `raw`. */
export function niceStep(raw: number): number {
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  for (const mult of [1, 2, 2.5, 5, 10]) {
    if (mult * magnitude >= raw) return mult * magnitude;
  }
  return 10 * magnitude;
}

/** Count of sorted values ≤ x (upper) or < x (lower). */
function countBelow(sorted: Float64Array, x: number, inclusive: boolean): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    const v = sorted[mid]!;
    if (inclusive ? v <= x : v < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function roundPrice(value: number): number {
  return Math.round(value * 1e8) / 1e8;
}

function isValidBar(c: TimeAtPriceCandle): boolean {
  return c.low > 0 && c.high >= c.low && Number.isFinite(c.high);
}

export function buildTimeAtPrice(
  candles: readonly TimeAtPriceCandle[],
  options: TimeAtPriceOptions,
): TimeAtPriceProfile | null {
  const all = candles.filter(isValidBar);
  const inRange = all.filter((c) => c.timestamp >= options.fromTs);
  if (inRange.length === 0) return null;

  let minLow = Number.POSITIVE_INFINITY;
  let maxHigh = 0;
  for (const c of inRange) {
    if (c.low < minLow) minLow = c.low;
    if (c.high > maxHigh) maxHigh = c.high;
  }
  const span = Math.max(maxHigh - minLow, minLow * 0.001);
  const binSize = niceStep(span / options.targetLevels);
  const volBinSize = niceStep(span / options.targetVolBins);

  // A bar covers level p when low ≤ p ≤ high; since high ≥ low that is #(low ≤ p) − #(high < p).
  const lows = Float64Array.from(inRange, (c) => c.low).sort();
  const highs = Float64Array.from(inRange, (c) => c.high).sort();
  const levels: TimeAtPriceLevel[] = [];
  const firstBin = Math.floor(minLow / binSize);
  const lastBin = Math.floor(maxHigh / binSize);
  for (let bin = firstBin; bin <= lastBin; bin++) {
    const price = roundPrice(bin * binSize);
    const bars = countBelow(lows, price, true) - countBelow(highs, price, false);
    levels.push({ price, bars });
  }

  const volSums = new Map<number, { sum: number; bars: number }>();
  let windowSum = 0;
  for (let i = 0; i < all.length; i++) {
    const bar = all[i]!;
    windowSum += Math.log(bar.high / bar.low) ** 2 / PARKINSON_DENOM;
    if (i >= options.volWindowBars) {
      const out = all[i - options.volWindowBars]!;
      windowSum -= Math.log(out.high / out.low) ** 2 / PARKINSON_DENOM;
    }
    if (i < options.volWindowBars - 1 || bar.timestamp < options.fromTs) continue;
    const vol = Math.sqrt(Math.max(0, windowSum / options.volWindowBars) * options.barsPerYear);
    const mid = (bar.high + bar.low) / 2;
    const bin = roundPrice(Math.floor(mid / volBinSize) * volBinSize);
    const entry = volSums.get(bin) ?? { sum: 0, bars: 0 };
    entry.sum += vol;
    entry.bars += 1;
    volSums.set(bin, entry);
  }
  const volByLevel = [...volSums.entries()]
    .sort(([a], [b]) => a - b)
    .map(([price, { sum, bars }]) => ({ price, vol: sum / bars, bars }));

  const closeByDay = new Map<number, number>();
  for (const c of inRange) closeByDay.set(Math.floor(c.timestamp / DAY_MS) * DAY_MS, c.close);
  const dailyCloses = [...closeByDay.entries()]
    .sort(([a], [b]) => a - b)
    .map(([ts, close]) => ({ ts, close }));

  return { binSize, volBinSize, levels, volByLevel, dailyCloses, bars: inRange.length };
}
