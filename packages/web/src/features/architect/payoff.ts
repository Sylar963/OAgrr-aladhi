/** Pure math for options P&L computation. No side effects, no imports from stores. */

export interface Leg {
  id: string;
  type: 'call' | 'put';
  direction: 'buy' | 'sell';
  strike: number;
  expiry: string;
  quantity: number;
  /** Quoted premium in USD */
  entryPrice: number;
  portfolioEntryPrice?: number;
  /** Underlying units represented by one contract. Defaults to 1. */
  contractMultiplier?: number;
  /** Best venue for this leg */
  venue: string;
  /** Greeks at entry */
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  iv: number | null;
}

/**
 * Linear hedge (perpetual or dated future) held next to the option legs. Kept out
 * of Leg because every Leg consumer assumes an option: it has no strike, premium
 * or expiry payoff kink, just delta 1 per coin from its entry price.
 */
export interface HedgeLeg {
  id: string;
  kind: 'perpetual' | 'future';
  direction: 'buy' | 'sell';
  /** Size in coin */
  quantity: number;
  /** Entry price in USD */
  entryPrice: number;
  instrumentName?: string;
}

export interface PayoffPoint {
  underlyingPrice: number;
  pnl: number;
}

export interface StrategyMetrics {
  maxProfit: number | null;
  maxLoss: number | null;
  breakevens: number[];
  netDebit: number;
  netDelta: number | null;
  netGamma: number | null;
  netTheta: number | null;
  netVega: number | null;
  /** Worst-case missing-leg count across the four greeks. 0 = fully reported. */
  greeksMissingLegs: number;
}

/** P&L of the linear hedges at a given underlying price. Time and IV do not move it. */
export function hedgePnlAtPrice(hedges: readonly HedgeLeg[], underlyingPrice: number): number {
  let total = 0;
  for (const hedge of hedges) {
    const sign = hedge.direction === 'buy' ? 1 : -1;
    total += sign * (underlyingPrice - hedge.entryPrice) * hedge.quantity;
  }
  return total;
}

/** Net delta of the linear hedges in coin. */
export function hedgeDelta(hedges: readonly HedgeLeg[]): number {
  return hedges.reduce((sum, h) => sum + (h.direction === 'buy' ? 1 : -1) * h.quantity, 0);
}

/** Total strategy P&L at expiry for a single underlying price. Used by V2 chart for zone classification. */
export function pnlAtPrice(
  legs: Leg[],
  underlyingPrice: number,
  hedges: readonly HedgeLeg[] = [],
): number {
  let total = hedgePnlAtPrice(hedges, underlyingPrice);
  for (const leg of legs) total += legPnlAtExpiry(leg, underlyingPrice);
  return total;
}

/** P&L of a single leg at expiry for a given underlying price. */
function legPnlAtExpiry(leg: Leg, underlyingPrice: number): number {
  const sign = leg.direction === 'buy' ? 1 : -1;
  let intrinsicValue: number;

  if (leg.type === 'call') {
    intrinsicValue = Math.max(0, underlyingPrice - leg.strike);
  } else {
    intrinsicValue = Math.max(0, leg.strike - underlyingPrice);
  }

  return (
    sign * (intrinsicValue - leg.entryPrice) * leg.quantity * (leg.contractMultiplier ?? 1)
  );
}

/**
 * Half-width of the price grid used by computePayoff / computeScenarioPayoff.
 *
 * The grid must cover every theoretical break-even, otherwise findBreakevens
 * silently drops the ones that fall outside it and the V2 zone shading paints
 * a single (-∞, upperBE) region that probes positive in the actual profit
 * tail — turning the whole loss zone green. A long straddle at a near-the-
 * money strike with rich premium hits this case (BEs at strike ± Σpremium,
 * which can sit ~30% outside spot for long-DTE ATM contracts).
 *
 * Σ|entryPrice × qty| is an upper bound on how far any BE can be from the
 * nearest strike, so anchoring the half-width on (max strike-to-spot distance
 * + Σ premium × margin) guarantees both BEs land inside with room to spare.
 */
function computeRangeHalf(
  legs: Leg[],
  spotPrice: number,
  minStrike: number,
  maxStrike: number,
): number {
  const totalPremium = legs.reduce(
    (s, l) => s + Math.abs(l.entryPrice) * l.quantity,
    0,
  );
  const maxStrikeDistFromSpot = Math.max(
    Math.abs(maxStrike - spotPrice),
    Math.abs(minStrike - spotPrice),
  );
  return Math.max(
    (maxStrike - minStrike) * 1.5,
    spotPrice * 0.3,
    maxStrikeDistFromSpot + totalPremium * 1.5,
  );
}

function priceAnchors(legs: Leg[], hedges: readonly HedgeLeg[]): number[] {
  return [...legs.map((l) => l.strike), ...hedges.map((h) => h.entryPrice)];
}

/** Compute total strategy P&L across a range of underlying prices. */
export function computePayoff(
  legs: Leg[],
  spotPrice: number,
  numPoints = 200,
  hedges: readonly HedgeLeg[] = [],
): PayoffPoint[] {
  if (legs.length === 0 && hedges.length === 0) return [];

  const anchors = priceAnchors(legs, hedges);
  const minStrike = Math.min(...anchors);
  const maxStrike = Math.max(...anchors);

  const rangeCenter = spotPrice;
  const rangeHalf = computeRangeHalf(legs, spotPrice, minStrike, maxStrike);
  const low = Math.max(0, rangeCenter - rangeHalf);
  const high = rangeCenter + rangeHalf;
  const step = (high - low) / numPoints;

  const points: PayoffPoint[] = [];
  for (let i = 0; i <= numPoints; i++) {
    const price = low + i * step;
    points.push({ underlyingPrice: price, pnl: pnlAtPrice(legs, price, hedges) });
  }

  return points;
}

/** Find breakeven points (where P&L crosses zero). */
function findBreakevens(points: PayoffPoint[]): number[] {
  const breakevens: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!;
    const curr = points[i]!;
    if ((prev.pnl <= 0 && curr.pnl >= 0) || (prev.pnl >= 0 && curr.pnl <= 0)) {
      // Linear interpolation. Keep full precision — rounding to whole dollars
      // here is fine for BTC/ETH but destroys sub-$100 altcoin break-evens (a
      // $0.42 BE rounds to 0, which fmtUsd then renders as "–"). Display-layer
      // formatters (fmtUsd, the chart) handle precision per underlying scale.
      const ratio = Math.abs(prev.pnl) / (Math.abs(prev.pnl) + Math.abs(curr.pnl));
      const be = prev.underlyingPrice + ratio * (curr.underlyingPrice - prev.underlyingPrice);
      breakevens.push(be);
    }
  }
  return breakevens;
}

/** Compute strategy-level metrics from legs. */
export function computeMetrics(
  legs: Leg[],
  spotPrice: number,
  hedges: readonly HedgeLeg[] = [],
): StrategyMetrics {
  const payoff = computePayoff(legs, spotPrice, 500, hedges);

  const pnls = payoff.map((p) => p.pnl);
  // Expiry P&L is piecewise linear with kinks at the strikes, so the extremes sit
  // on a strike the grid usually steps over (a fly's peak read ~10% low).
  const low = payoff[0]?.underlyingPrice ?? 0;
  const high = payoff.at(-1)?.underlyingPrice ?? 0;
  const kinkPnls = priceAnchors(legs, hedges)
    .filter((price) => price >= low && price <= high)
    .map((price) => pnlAtPrice(legs, price, hedges));
  const maxPnl = Math.max(...pnls, ...kinkPnls);
  const minPnl = Math.min(...pnls, ...kinkPnls);

  // Detect unbounded P&L by slope at the range edges: if the curve is still
  // changing at the boundary, extrapolating further keeps growing / falling.
  // Bounded strategies plateau before the edge so both slopes go to ~0.
  const n = pnls.length;
  const highSlope = (pnls[n - 1] ?? 0) - (pnls[n - 2] ?? 0);
  const lowSlope = (pnls[1] ?? 0) - (pnls[0] ?? 0);
  // Threshold must scale with the strategy's P&L magnitude. A flat $1 reads as
  // "still sloping" for a BTC position but as "flat" for a sub-$1k altcoin, so
  // low-priced underlyings had their unbounded tails (e.g. a long straddle's
  // infinite upside) misreported as a small finite max profit/loss. Gauge the
  // edge slope against the total P&L span instead — a genuinely capped edge is
  // ≈0 relative to the span at any price scale.
  const FLAT_EPS = Math.max((maxPnl - minPnl) * 1e-4, Number.EPSILON);
  const profitUnbounded = highSlope > FLAT_EPS || lowSlope < -FLAT_EPS;
  const lossUnbounded = highSlope < -FLAT_EPS || lowSlope > FLAT_EPS;
  const maxProfit = profitUnbounded ? null : maxPnl;
  const maxLoss = lossUnbounded ? null : minPnl;

  const netDebit = legs.reduce((sum, leg) => {
    const sign = leg.direction === 'buy' ? -1 : 1;
    return sum + sign * leg.entryPrice * leg.quantity * (leg.contractMultiplier ?? 1);
  }, 0);

  const sumGreek = (
    pick: (l: Leg) => number | null,
  ): { value: number | null; missing: number } => {
    let total = 0;
    let reported = 0;
    let missing = 0;
    for (const leg of legs) {
      const val = pick(leg);
      if (val == null) {
        missing++;
        continue;
      }
      reported++;
      const sign = leg.direction === 'buy' ? 1 : -1;
      total += sign * val * leg.quantity * (leg.contractMultiplier ?? 1);
    }
    return { value: reported > 0 ? total : null, missing };
  };

  const optionDelta = sumGreek((l) => l.delta);
  const delta =
    hedges.length === 0 || (legs.length > 0 && optionDelta.value == null)
      ? optionDelta
      : { ...optionDelta, value: (optionDelta.value ?? 0) + hedgeDelta(hedges) };
  const gamma = sumGreek((l) => l.gamma);
  const theta = sumGreek((l) => l.theta);
  const vega = sumGreek((l) => l.vega);
  const greeksMissingLegs = Math.max(delta.missing, gamma.missing, theta.missing, vega.missing);

  return {
    maxProfit,
    maxLoss,
    breakevens: findBreakevens(payoff),
    netDebit,
    netDelta: delta.value,
    netGamma: gamma.value,
    netTheta: theta.value,
    netVega: vega.value,
    greeksMissingLegs,
  };
}

/**
 * Compute P&L at a point in time before expiry using Black-Scholes approximation.
 * Uses leg IV + shift to estimate option value at the given DTE.
 */
function bsApprox(type: 'call' | 'put', S: number, K: number, iv: number, dte: number): number {
  if (dte <= 0) return type === 'call' ? Math.max(0, S - K) : Math.max(0, K - S);
  const T = dte / 365;
  const sigma = iv;
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + 0.5 * sigma * sigma * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  const nd1 = 0.5 * (1 + erf(d1 / Math.SQRT2));
  const nd2 = 0.5 * (1 + erf(d2 / Math.SQRT2));
  if (type === 'call') return S * nd1 - K * nd2;
  return K * (1 - nd2) - S * (1 - nd1);
}

function erf(x: number): number {
  const a1 = 0.254829592,
    a2 = -0.284496736,
    a3 = 1.421413741,
    a4 = -1.453152027,
    a5 = 1.061405429,
    p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const t = 1 / (1 + p * Math.abs(x));
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}

/** Compute scenario P&L with IV shift and/or DTE shift. */
export function computeScenarioPayoff(
  legs: Leg[],
  spotPrice: number,
  ivShift: number,
  dteShift: number,
  baseDte: number,
  numPoints = 200,
  hedges: readonly HedgeLeg[] = [],
): PayoffPoint[] {
  if (legs.length === 0 && hedges.length === 0) return [];
  const anchors = priceAnchors(legs, hedges);
  const minStrike = Math.min(...anchors);
  const maxStrike = Math.max(...anchors);
  const rangeCenter = spotPrice;
  const rangeHalf = computeRangeHalf(legs, spotPrice, minStrike, maxStrike);
  const low = Math.max(0, rangeCenter - rangeHalf);
  const high = rangeCenter + rangeHalf;
  const step = (high - low) / numPoints;

  const targetDte = Math.max(0, baseDte + dteShift);

  const points: PayoffPoint[] = [];
  for (let i = 0; i <= numPoints; i++) {
    const price = low + i * step;
    let totalPnl = hedgePnlAtPrice(hedges, price);
    for (const leg of legs) {
      const sign = leg.direction === 'buy' ? 1 : -1;
      const iv = (leg.iv ?? 0.5) + ivShift;
      const optionVal = bsApprox(leg.type, price, leg.strike, Math.max(0.01, iv), targetDte);
      totalPnl +=
        sign *
        (optionVal - leg.entryPrice) *
        leg.quantity *
        (leg.contractMultiplier ?? 1);
    }
    points.push({ underlyingPrice: price, pnl: totalPnl });
  }
  return points;
}

/** Detect common strategy names from leg configuration. */
interface Ramp {
  bull: boolean;
  low: number;
  high: number;
}

/** A vertical's expiry payoff ramps between its strikes, up when the lower strike is long (calls and puts alike). */
function rampOf(longStrike: number, shortStrike: number): Ramp | null {
  if (longStrike === shortStrike) return null;
  return {
    bull: longStrike < shortStrike,
    low: Math.min(longStrike, shortStrike),
    high: Math.max(longStrike, shortStrike),
  };
}

/**
 * A bull and a bear vertical that don't overlap form a tent (short iron: profit
 * in the middle) or a trough (reverse iron). Judged on payoff, not strike layout,
 * so a bull call spread under a bear put spread (an iron fly with ITM wings,
 * paid as a debit) is named like the textbook credit version. Mirrors
 * `ironKind` in core's portfolio/strategy-groups.ts.
 */
function ironStructure(put: Ramp | null, call: Ramp | null): string | null {
  if (!put || !call || put.bull === call.bull) return null;
  const [first, second] = put.high <= call.low ? [put, call] : call.high <= put.low ? [call, put] : [];
  if (!first || !second) return null;
  const shape = first.high === second.low ? 'Iron Butterfly' : 'Iron Condor';
  return first.bull ? shape : `Reverse ${shape}`;
}

export function detectStrategy(legs: Leg[]): string {
  if (legs.length === 0) return 'Empty';
  if (legs.length === 1) {
    const l = legs[0]!;
    const side = l.direction === 'buy' ? 'Long' : 'Short';
    return `${side} ${l.type === 'call' ? 'Call' : 'Put'}`;
  }

  const sorted = [...legs].sort((a, b) => a.strike - b.strike);
  const types = sorted.map((l) => l.type);
  const strikes = sorted.map((l) => l.strike);
  const sameExpiry = new Set(sorted.map((l) => l.expiry)).size === 1;

  if (legs.length === 2 && sameExpiry) {
    const [a, b] = sorted;
    if (!a || !b) return 'Custom';

    // Straddle: same strike, call + put, same direction
    if (a.strike === b.strike && a.type !== b.type && a.direction === b.direction) {
      return a.direction === 'buy' ? 'Long Straddle' : 'Short Straddle';
    }

    // Strangle: different strikes, call + put, same direction
    if (
      a.strike !== b.strike &&
      types.includes('call') &&
      types.includes('put') &&
      a.direction === b.direction
    ) {
      return a.direction === 'buy' ? 'Long Strangle' : 'Short Strangle';
    }

    // Vertical spreads: same type, different strikes, opposite directions
    if (a.type === b.type && a.direction !== b.direction) {
      const buyLeg = a.direction === 'buy' ? a : b;
      const sellLeg = a.direction === 'buy' ? b : a;
      if (a.type === 'call') {
        return buyLeg.strike < sellLeg.strike ? 'Bull Call Spread' : 'Bear Call Spread';
      }
      return buyLeg.strike > sellLeg.strike ? 'Bear Put Spread' : 'Bull Put Spread';
    }
  }

  // Butterfly: 3 legs (buy 1 / sell 2× / buy 1) — detected before 4-leg
  if (legs.length === 3 && sameExpiry) {
    const uniqueStrikes = [...new Set(strikes)];
    if (uniqueStrikes.length === 3 && types.every((t) => t === types[0])) {
      const midLeg = sorted[1];
      if (midLeg && midLeg.quantity === 2 && midLeg.direction !== sorted[0]!.direction) {
        return types[0] === 'call' ? 'Call Butterfly' : 'Put Butterfly';
      }
    }
  }

  if (legs.length === 4 && sameExpiry) {
    const calls = sorted.filter((l) => l.type === 'call');
    const puts = sorted.filter((l) => l.type === 'put');

    if (calls.length === 2 && puts.length === 2) {
      const buyPuts = puts.filter((l) => l.direction === 'buy');
      const sellPuts = puts.filter((l) => l.direction === 'sell');
      const buyCalls = calls.filter((l) => l.direction === 'buy');
      const sellCalls = calls.filter((l) => l.direction === 'sell');

      if (
        buyPuts.length === 1 &&
        sellPuts.length === 1 &&
        buyCalls.length === 1 &&
        sellCalls.length === 1
      ) {
        const bp = buyPuts[0]!.strike;
        const sp = sellPuts[0]!.strike;
        const sc = sellCalls[0]!.strike;
        const bc = buyCalls[0]!.strike;

        const sameSize = sorted.every((l) => l.quantity === sorted[0]!.quantity);
        const iron = sameSize ? ironStructure(rampOf(bp, sp), rampOf(bc, sc)) : null;
        if (iron) return iron;

        // Straddle Spread: long straddle at one strike, short straddle at the
        // other. Two unique strikes, both options at each strike share a
        // direction. Bullish if the long straddle is at the lower strike.
        if (bp === bc && sp === sc && bp !== sp) {
          return bp < sp ? 'Long Straddle Spread' : 'Short Straddle Spread';
        }
      }
    }
  }

  return `Custom (${legs.length} legs)`;
}
