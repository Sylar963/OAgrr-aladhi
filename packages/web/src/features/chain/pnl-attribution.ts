// Black-76 (forward-based, r=0) duplicated locally because the web package
// has no dependency on @oggregator/core. Mirrors core/feeds/thalex/bs-solver.ts
// — keep in sync if the underlying math changes. Crypto convention: r=0, IV
// stored as fractions (0.50 = 50%), theta returned per calendar day, vega per
// unit sigma (Δsigma=1.0). Year-day count uses 365 to match core's tYears
// (core/feeds/thalex/bs-solver.ts) so this attribution reproduces the live
// chain IV computation exactly.

import type { OptionRight } from '@lib/analytics/blackScholes';

export type { OptionRight };

const SQRT_2PI = Math.sqrt(2 * Math.PI);

export function bs76Pdf(x: number): number {
  return Math.exp(-0.5 * x * x) / SQRT_2PI;
}

// Abramowitz & Stegun 7.1.26 — error < 1.5e-7.
export function bs76Cdf(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + p * ax);
  const y =
    1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return 0.5 * (1 + sign * y);
}

export function bs76D1(f: number, k: number, sigma: number, tYears: number): number {
  return (Math.log(f / k) + 0.5 * sigma * sigma * tYears) / (sigma * Math.sqrt(tYears));
}

export function bs76Price(
  f: number, k: number, sigma: number, tYears: number, right: OptionRight,
): number {
  const d1 = bs76D1(f, k, sigma, tYears);
  const d2 = d1 - sigma * Math.sqrt(tYears);
  return right === 'call'
    ? f * bs76Cdf(d1) - k * bs76Cdf(d2)
    : k * bs76Cdf(-d2) - f * bs76Cdf(-d1);
}

export function bs76Delta(
  f: number, k: number, sigma: number, tYears: number, right: OptionRight,
): number {
  const d1 = bs76D1(f, k, sigma, tYears);
  return right === 'call' ? bs76Cdf(d1) : bs76Cdf(d1) - 1;
}

export function bs76Gamma(f: number, k: number, sigma: number, tYears: number): number {
  return bs76Pdf(bs76D1(f, k, sigma, tYears)) / (f * sigma * Math.sqrt(tYears));
}

export function bs76Vega(f: number, k: number, sigma: number, tYears: number): number {
  return f * Math.sqrt(tYears) * bs76Pdf(bs76D1(f, k, sigma, tYears));
}

// Theta per calendar day at r=0. Sign: negative for long options.
export function bs76ThetaPerDay(
  f: number, k: number, sigma: number, tYears: number,
): number {
  const annual = -(f * bs76Pdf(bs76D1(f, k, sigma, tYears)) * sigma) / (2 * Math.sqrt(tYears));
  return annual / 365;
}

export interface SolveIvInput {
  price: number;
  forward: number;
  strike: number;
  tYears: number;
  right: OptionRight;
  seed: number | null;
}

// Newton-Raphson on σ. Bails on no-arb violations and pathological vega.
// Matches the structure of core/feeds/thalex/bs-solver.ts so behaviour is
// identical to the live IV computation done by the chain enrichment path.
export function solveIvBs76(input: SolveIvInput): number | null {
  const { price, forward, strike, tYears, right, seed } = input;
  if (!Number.isFinite(price) || !Number.isFinite(forward) || !Number.isFinite(tYears)) return null;
  if (!(price > 0 && forward > 0 && strike > 0 && tYears > 0)) return null;

  const intrinsic = right === 'call' ? Math.max(0, forward - strike) : Math.max(0, strike - forward);
  const upper = right === 'call' ? forward : strike;
  if (price <= intrinsic || price >= upper) return null;

  let sigma = seed != null && Number.isFinite(seed) && seed > 0.01 && seed < 5 ? seed : 0.5;
  for (let i = 0; i < 32; i++) {
    const diff = bs76Price(forward, strike, sigma, tYears, right) - price;
    if (Math.abs(diff) < 1e-6) return sigma;
    const v = bs76Vega(forward, strike, sigma, tYears);
    if (!(v > 1e-10)) return null;
    sigma -= diff / v;
    if (!Number.isFinite(sigma) || sigma <= 0 || sigma > 10) return null;
  }
  return null;
}

export interface AttributionBar {
  ts: number;        // milliseconds since epoch
  mark: number;      // option mark close in display units
  forward: number;   // matching forward close in same display units
}

export interface AttributionInput {
  bars: readonly AttributionBar[];
  strike: number;
  right: OptionRight;
  expirationMs: number;
  /** Initial IV seed for Newton — last solved sigma is reused as the seed for the next bar. */
  initialSeed?: number;
}

export interface AttributionPoint {
  ts: number;
  totalPL: number;
  deltaPL: number;
  gammaPL: number;
  thetaPL: number;
  vegaPL: number;
  residualPL: number;
  iv: number;            // solved at this bar (close)
  forward: number;
  mark: number;
}

export interface AttributionSummary {
  deltaPct: number;
  gammaPct: number;
  thetaPct: number;
  vegaPct: number;
  residualPct: number;
  totalPL: number;
  attributedPL: number;
  /** Number of bars where IV solve failed and the bar was skipped. */
  skipped: number;
}

export interface AttributionResult {
  points: AttributionPoint[];
  summary: AttributionSummary;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const YEAR_MS = 365 * MS_PER_DAY;

// Helper: solve IV for one bar; returns null on no-arb violation or pathological vega.
function solveBar(
  bar: AttributionBar,
  strike: number,
  right: OptionRight,
  expirationMs: number,
  seed: number | null,
): number | null {
  const tYears = (expirationMs - bar.ts) / YEAR_MS;
  if (!(tYears > 0)) return null;
  return solveIvBs76({
    price: bar.mark,
    forward: bar.forward,
    strike,
    tYears,
    right,
    seed,
  });
}

// First-order Taylor expansion:
//   dPL ≈ Δ·dS + ½Γ·dS² + Θ·dT + V·dIV + residual
// Greeks are evaluated at the LEFT edge of each interval (shift-by-one), so the
// attribution describes the move just completed using the position the trader
// held before it. Matches the notebook's `.shift(1)` convention.
export function attributePnL(input: AttributionInput): AttributionResult {
  const { bars, strike, right, expirationMs } = input;
  const points: AttributionPoint[] = [];
  let skipped = 0;

  let prevSeed: number | null = input.initialSeed ?? null;
  let prev: { bar: AttributionBar; iv: number } | null = null;

  for (const bar of bars) {
    const iv = solveBar(bar, strike, right, expirationMs, prevSeed);
    if (iv == null) {
      // Bar contributes no IV — drop the segment that would have ended here,
      // and reset prev so the next valid bar starts a fresh segment.
      if (prev != null) skipped++;
      // Keep prevSeed pointing at the last valid IV — Newton converges faster
      // from a regime-continuous seed than from a cold 0.5, even across a one-bar
      // gap. prev itself resets so the next segment starts fresh.
      prev = null;
      continue;
    }
    if (prev != null) {
      const tYearsPrev = (expirationMs - prev.bar.ts) / YEAR_MS;
      if (tYearsPrev > 0) {
        const delta = bs76Delta(prev.bar.forward, strike, prev.iv, tYearsPrev, right);
        const gamma = bs76Gamma(prev.bar.forward, strike, prev.iv, tYearsPrev);
        const vega = bs76Vega(prev.bar.forward, strike, prev.iv, tYearsPrev);
        const thetaPerDay = bs76ThetaPerDay(prev.bar.forward, strike, prev.iv, tYearsPrev);

        const dS = bar.forward - prev.bar.forward;
        const dT = (bar.ts - prev.bar.ts) / MS_PER_DAY;
        const dIv = iv - prev.iv;

        const deltaPL = delta * dS;
        const gammaPL = 0.5 * gamma * dS * dS;
        const thetaPL = thetaPerDay * dT;
        const vegaPL = vega * dIv;
        const totalPL = bar.mark - prev.bar.mark;
        const attributed = deltaPL + gammaPL + thetaPL + vegaPL;
        const residualPL = totalPL - attributed;

        points.push({
          ts: bar.ts, totalPL, deltaPL, gammaPL, thetaPL, vegaPL, residualPL,
          iv, forward: bar.forward, mark: bar.mark,
        });
      } else {
        // Bar is at or past expiration — no meaningful Greek to evaluate.
        skipped++;
      }
    }
    prev = { bar, iv };
    prevSeed = iv;
  }

  // Summary: percentage of |contribution| each component is responsible for.
  // Using absolute values matches Bloomberg-style attribution reports — when
  // delta and theta cancel, both should still register as material drivers.
  let absDelta = 0, absGamma = 0, absTheta = 0, absVega = 0, absResid = 0;
  let totalPL = 0, attributedPL = 0;
  for (const p of points) {
    absDelta += Math.abs(p.deltaPL);
    absGamma += Math.abs(p.gammaPL);
    absTheta += Math.abs(p.thetaPL);
    absVega += Math.abs(p.vegaPL);
    absResid += Math.abs(p.residualPL);
    totalPL += p.totalPL;
    attributedPL += p.deltaPL + p.gammaPL + p.thetaPL + p.vegaPL;
  }
  const denom = absDelta + absGamma + absTheta + absVega + absResid;
  const safe = (x: number) => (denom > 0 ? x / denom : 0);

  return {
    points,
    summary: {
      deltaPct: safe(absDelta),
      gammaPct: safe(absGamma),
      thetaPct: safe(absTheta),
      vegaPct: safe(absVega),
      residualPct: safe(absResid),
      totalPL,
      attributedPL,
      skipped,
    },
  };
}
