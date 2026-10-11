import { cdf, d1, delta76, price76 } from '../feeds/thalex/bs-solver.js';
import type { OptionRight } from '../types/common.js';

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_HISTORICAL_WINDOWS = 30;

// Spread selected strikes across the delta range instead of crowding the 1k-spaced strikes
// near the money; the far wings are where implied and historical odds disagree most.
const TARGET_ABS_DELTAS = [0.5, 0.4, 0.3, 0.2, 0.12, 0.06, 0.025, 0.01];

export interface BreakEvenSmile {
  ts: number;
  expiryTs: number;
  forward: number;
  strikes: readonly number[];
  markIvs: readonly number[];
}

export interface BreakEvenPathPoint {
  ts: number;
  value: number;
}

export interface BreakEvenCandidate {
  strike: number;
  right: OptionRight;
  delta: number;
}

function yearsBetween(fromTs: number, toTs: number): number {
  return Math.max(0, (toTs - fromTs) / YEAR_MS);
}

/** Black-76 premium (USD, undiscounted) added to or subtracted from the strike. */
export function breakEvenLevel(
  forward: number,
  strike: number,
  iv: number,
  tYears: number,
  right: OptionRight,
): number {
  const premium =
    tYears > 0 && iv > 0
      ? price76(forward, strike, iv, tYears, right)
      : Math.max(0, right === 'call' ? forward - strike : strike - forward);
  return right === 'call' ? strike + premium : strike - premium;
}

/** Risk-neutral probability of finishing beyond the strike: N(d2) for calls, N(−d2) for puts. */
export function impliedExceedance(
  forward: number,
  strike: number,
  iv: number,
  tYears: number,
  right: OptionRight,
): number {
  if (!(tYears > 0 && iv > 0)) {
    const beyond = right === 'call' ? forward > strike : forward < strike;
    return beyond ? 1 : 0;
  }
  const d2 = d1(forward, strike, iv, tYears) - iv * Math.sqrt(tYears);
  return right === 'call' ? cdf(d2) : cdf(-d2);
}

export function black76Delta(
  forward: number,
  strike: number,
  iv: number,
  tYears: number,
  right: OptionRight,
): number {
  if (!(tYears > 0 && iv > 0)) return 0;
  return delta76(forward, strike, iv, tYears, right);
}

/**
 * Out-of-the-money strikes with |delta| inside the band. When a side has more than
 * `maxPerSide`, keeps the strike nearest each target delta.
 */
export function selectBreakEvenStrikes<T extends BreakEvenCandidate>(
  forward: number,
  candidates: readonly T[],
  maxPerSide: number,
  maxAbsDelta = 0.55,
  minAbsDelta = 0.003,
): T[] {
  const pick = (right: OptionRight): T[] => {
    const side = candidates.filter((candidate) => {
      if (candidate.right !== right) return false;
      const otm = right === 'call' ? candidate.strike >= forward : candidate.strike < forward;
      const abs = Math.abs(candidate.delta);
      return otm && abs <= maxAbsDelta && abs >= minAbsDelta;
    });
    if (side.length <= maxPerSide) return side;
    const chosen = new Set<T>();
    const last = TARGET_ABS_DELTAS.length - 1;
    const targets =
      maxPerSide >= TARGET_ABS_DELTAS.length
        ? TARGET_ABS_DELTAS
        : Array.from(
            { length: maxPerSide },
            (_, i) => TARGET_ABS_DELTAS[maxPerSide === 1 ? 0 : Math.round((i * last) / (maxPerSide - 1))]!,
          );
    for (const target of targets) {
      let best: T | null = null;
      for (const candidate of side) {
        if (chosen.has(candidate)) continue;
        if (
          best == null ||
          Math.abs(Math.abs(candidate.delta) - target) < Math.abs(Math.abs(best.delta) - target)
        ) {
          best = candidate;
        }
      }
      if (best != null) chosen.add(best);
    }
    return side.filter((candidate) => chosen.has(candidate));
  };
  return [...pick('call'), ...pick('put')].sort((a, b) => b.strike - a.strike);
}

/** Break-even path rebuilt from recorded smiles; slots where the strike was not quoted are skipped. */
export function breakEvenHistory(
  smiles: readonly BreakEvenSmile[],
  strike: number,
  right: OptionRight,
): BreakEvenPathPoint[] {
  const points: BreakEvenPathPoint[] = [];
  for (const smile of smiles) {
    const index = smile.strikes.indexOf(strike);
    const iv = index === -1 ? undefined : smile.markIvs[index];
    if (iv == null || !(iv > 0)) continue;
    const value = breakEvenLevel(
      smile.forward,
      strike,
      iv,
      yearsBetween(smile.ts, smile.expiryTs),
      right,
    );
    if (Number.isFinite(value)) points.push({ ts: smile.ts, value });
  }
  return points;
}

/**
 * Where the break-even goes if forward and IV stay where they are: time decay alone pulls it
 * toward the strike. Points on `stepMs` boundaries after `fromTs`, ending at expiry.
 */
export function projectBreakEven(
  forward: number,
  strike: number,
  iv: number,
  right: OptionRight,
  fromTs: number,
  expiryTs: number,
  stepMs: number,
): BreakEvenPathPoint[] {
  if (!(expiryTs > fromTs) || !(stepMs > 0)) return [];
  const points: BreakEvenPathPoint[] = [
    { ts: fromTs, value: breakEvenLevel(forward, strike, iv, yearsBetween(fromTs, expiryTs), right) },
  ];
  for (let ts = (Math.floor(fromTs / stepMs) + 1) * stepMs; ts < expiryTs; ts += stepMs) {
    points.push({ ts, value: breakEvenLevel(forward, strike, iv, yearsBetween(ts, expiryTs), right) });
  }
  points.push({ ts: expiryTs, value: breakEvenLevel(forward, strike, iv, 0, right) });
  return points;
}

export interface HorizonReturns {
  horizonDays: number;
  /** Demeaned log returns, sorted ascending. */
  sorted: Float64Array;
}

/**
 * Overlapping `horizonDays`-day log returns from daily closes with the sample mean removed,
 * so the comparison with the option market is about width and tails, not the trend of the
 * lookback window. Returns null when there are too few windows to say anything.
 */
export function horizonLogReturns(
  closes: readonly number[],
  horizonDays: number,
): HorizonReturns | null {
  const n = Math.max(1, Math.round(horizonDays));
  const count = closes.length - n;
  if (count < MIN_HISTORICAL_WINDOWS) return null;
  const returns = new Float64Array(count);
  let sum = 0;
  for (let i = 0; i < count; i++) {
    const from = closes[i]!;
    const to = closes[i + n]!;
    const value = from > 0 && to > 0 ? Math.log(to / from) : 0;
    returns[i] = value;
    sum += value;
  }
  const mean = sum / count;
  for (let i = 0; i < count; i++) returns[i] = returns[i]! - mean;
  returns.sort();
  return { horizonDays: n, sorted: returns };
}

/** Share of historical moves that would have taken the forward beyond the strike. */
export function historicalExceedance(
  returns: HorizonReturns,
  forward: number,
  strike: number,
  right: OptionRight,
): number {
  const threshold = Math.log(strike / forward);
  const { sorted } = returns;
  return right === 'call'
    ? (sorted.length - countBelow(sorted, threshold, true)) / sorted.length
    : countBelow(sorted, threshold, false) / sorted.length;
}

function countBelow(sorted: Float64Array, threshold: number, inclusive: boolean): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    const value = sorted[mid]!;
    if (inclusive ? value <= threshold : value < threshold) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function daysToExpiry(nowTs: number, expiryTs: number): number {
  return Math.max(0, (expiryTs - nowTs) / DAY_MS);
}
