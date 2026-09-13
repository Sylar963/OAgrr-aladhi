import type { EnrichedStrike, VenueQuote, VenueId } from '@shared/enriched';
import { black76Price, black76Probability, normCdf, realWorldPop, type OptionRight } from './blackScholes';
import { inferMissingIv } from './ivInference';

export type SpreadKind = 'call-credit' | 'put-credit';
export type TradingSignal = 'SELL' | 'AVOID';
export type RegimeLabel = 'low-vol' | 'mid-vol' | 'high-vol';
export type RegimeDirection = 'risk-on' | 'neutral' | 'risk-off';

// Physical-measure assumptions replace risk-neutral inputs for POP and EV.
export interface RealWorldParams {
  drift: number;
  sigmaRV: number;
}

export interface SpreadInput {
  kind: SpreadKind;
  shortStrike: number;
  longStrike: number;
  strikes: readonly EnrichedStrike[];
  spot: number;
  forward: number;
  T: number;
  nowMs?: number;
  // When empty, considers every venue present in the chain.
  venues?: readonly VenueId[];
  // Optional O(1) strike lookup. When omitted, falls back to linear scan on
  // `strikes`. Callers that run on every WS tick (≈5Hz) should precompute this
  // once per snapshot and pass it in; otherwise the pricer does O(n) on the
  // strike list twice per invocation.
  strikeByKey?: ReadonlyMap<number, EnrichedStrike>;
  // Optional smile interpolator for risk-neutral probability at breakeven.
  ivAtStrike?: (strike: number) => number | null;
  // When provided, success probability and EV are computed from physical
  // drift and realized vol instead of the risk-neutral surface IV.
  realWorld?: RealWorldParams;
  // When provided, the SELL gate's ROC threshold flexes with the macro
  // regime: high-vol tightens the gate to account for nonlinear tail risk.
  // Drives `gateSignal` only; pricing/EV are unaffected.
  regimeDominant?: RegimeLabel | null;
}

export interface VenueLegCandidate {
  venue: VenueId;
  /** IV used for pricing this leg (after inference fallback). */
  iv: number | null;
  /** Executable premium at this venue — bid price for sell, ask price for buy. */
  executablePrice: number | null;
  /** Post-fee net: sell gets bid - taker fee, buy gets ask + taker fee. */
  netAfterFees: number | null;
  takerFee: number | null;
  size: number | null;
  minQuantity: number | null;
  quantityStep: number | null;
  asOfMs: number | null;
  settleCurrency: string | null;
  inverse: boolean | null;
  sourcedIv: 'bidIv' | 'askIv' | 'markIv' | 'inferred' | null;
}

export interface LegRoute {
  best: VenueLegCandidate | null;
  candidates: VenueLegCandidate[];
}

export interface SpreadSignal {
  signal: TradingSignal;
  reasoning: string;
  netCredit: number;
  maxProfit: number;
  maxLoss: number;
  breakeven: number;
  riskReward: number;
  successProbability: number;
  // 'real-world'   = N(±d₂) at the configured physical drift μ and realized σ_RV.
  // 'risk-neutral' = Black-76 N(±d₂) at breakeven IV and the expiry forward.
  probabilityMethod: 'real-world' | 'risk-neutral';
  // Premium received minus the modeled continuous spread payoff.
  expectedValue: number;
  // Return on capital: ev / maxLoss. The gate threshold for SELL is roc ≥ 0.10.
  roc: number;
}

export interface RoutedSpreadAnalysis {
  kind: SpreadKind;
  shortStrike: number;
  longStrike: number;
  right: OptionRight;
  spreadWidth: number;
  short: LegRoute;
  long: LegRoute;
  /** Signal computed from a synchronized, size-valid same-venue pair after fees. */
  combinedSignal: SpreadSignal | null;
  /** Signal from surface-level IV (average across selected venues), for reference. */
  surfaceSignal: SpreadSignal | null;
  routeVenue: VenueId | null;
  maxQuantity: number | null;
  quoteSkewMs: number | null;
  theoreticalIndependentNetCredit: number | null;
}

// ── Helpers ────────────────────────────────────────────────────────

function findStrike(
  strikes: readonly EnrichedStrike[],
  targetStrike: number,
  byKey?: ReadonlyMap<number, EnrichedStrike>,
): EnrichedStrike | null {
  if (byKey) return byKey.get(targetStrike) ?? null;
  return strikes.find((s) => s.strike === targetStrike) ?? null;
}

function rightForKind(kind: SpreadKind): OptionRight {
  return kind === 'call-credit' ? 'call' : 'put';
}

function sideForKind(strike: EnrichedStrike, kind: SpreadKind) {
  return kind === 'call-credit' ? strike.call : strike.put;
}

function venueSet(
  shortSide: EnrichedStrike | null,
  longSide: EnrichedStrike | null,
  kind: SpreadKind,
  filter: readonly VenueId[] | undefined,
): VenueId[] {
  const set = new Set<VenueId>();
  if (shortSide) {
    for (const v of Object.keys(sideForKind(shortSide, kind).venues) as VenueId[]) set.add(v);
  }
  if (longSide) {
    for (const v of Object.keys(sideForKind(longSide, kind).venues) as VenueId[]) set.add(v);
  }
  if (filter && filter.length > 0) {
    const allow = new Set(filter);
    return [...set].filter((v) => allow.has(v));
  }
  return [...set];
}

function priceAtIv(right: OptionRight, forward: number, strike: number, T: number, iv: number) {
  return black76Price(right, forward, strike, T, iv);
}

// Builds the per-venue candidate table for one leg.
// leg = 'sell' → prefer bidIv, use executable = bid price, fees reduce credit.
// leg = 'buy'  → prefer askIv, use executable = ask price, fees add to cost.
function buildLegCandidates(
  strike: EnrichedStrike | null,
  strikeValue: number,
  leg: 'sell' | 'buy',
  kind: SpreadKind,
  forward: number,
  T: number,
  venues: readonly VenueId[],
): VenueLegCandidate[] {
  if (!strike) return [];
  const right = rightForKind(kind);
  const side = sideForKind(strike, kind);
  const candidates: VenueLegCandidate[] = [];

  for (const venueId of venues) {
    const raw = side.venues[venueId];
    if (!raw) continue;
    const patched = inferMissingIv(raw, { forward, strike: strikeValue, T, right });

    let iv: number | null;
    let sourcedIv: VenueLegCandidate['sourcedIv'];
    if (leg === 'sell') {
      if (raw.bidIv != null) {
        iv = raw.bidIv;
        sourcedIv = 'bidIv';
      } else if (patched.bidIv != null) {
        iv = patched.bidIv;
        sourcedIv = 'inferred';
      } else {
        iv = raw.markIv ?? patched.markIv;
        sourcedIv = 'markIv';
      }
    } else {
      if (raw.askIv != null) {
        iv = raw.askIv;
        sourcedIv = 'askIv';
      } else if (patched.askIv != null) {
        iv = patched.askIv;
        sourcedIv = 'inferred';
      } else {
        iv = raw.markIv ?? patched.markIv;
        sourcedIv = 'markIv';
      }
    }

    const execution = raw.execution;
    const executablePrice = leg === 'sell'
      ? execution?.bidUsd ?? raw.bid
      : execution?.askUsd ?? raw.ask;
    const size = leg === 'sell'
      ? execution?.bidSize ?? null
      : execution?.askSize ?? null;
    const takerFee = leg === 'sell'
      ? execution?.bidTakerFeeUsd ?? null
      : execution?.askTakerFeeUsd ?? null;
    const hasExecutableQuote = executablePrice != null && executablePrice > 0;
    const netAfterFees = hasExecutableQuote && takerFee != null
      ? leg === 'sell'
        ? executablePrice - takerFee
        : executablePrice + takerFee
      : null;

    candidates.push({
      venue: venueId,
      iv,
      executablePrice,
      netAfterFees,
      takerFee,
      size,
      minQuantity: execution?.minQuantity ?? null,
      quantityStep: execution?.quantityStep ?? null,
      asOfMs: raw.asOfMs ?? null,
      settleCurrency: execution?.settleCurrency ?? null,
      inverse: execution?.inverse ?? null,
      sourcedIv,
    });
  }

  return candidates;
}

function pickBestSell(cands: VenueLegCandidate[]): VenueLegCandidate | null {
  let best: VenueLegCandidate | null = null;
  for (const c of cands) {
    if (c.netAfterFees == null) continue;
    if (best == null || c.netAfterFees > (best.netAfterFees ?? -Infinity)) best = c;
  }
  return best;
}

function pickBestBuy(cands: VenueLegCandidate[]): VenueLegCandidate | null {
  let best: VenueLegCandidate | null = null;
  for (const c of cands) {
    if (c.netAfterFees == null) continue;
    if (best == null || c.netAfterFees < (best.netAfterFees ?? Infinity)) best = c;
  }
  return best;
}

const MAX_LEG_QUOTE_SKEW_MS = 2_000;
const MAX_QUOTE_AGE_MS = 60_000;

interface VenuePair {
  short: VenueLegCandidate;
  long: VenueLegCandidate;
  netCredit: number;
  maxQuantity: number;
  quoteSkewMs: number;
}

function executableQuantity(short: VenueLegCandidate, long: VenueLegCandidate): number | null {
  if (
    short.size == null ||
    long.size == null ||
    short.minQuantity == null ||
    long.minQuantity == null ||
    short.quantityStep == null ||
    long.quantityStep == null ||
    short.size <= 0 ||
    long.size <= 0 ||
    short.quantityStep <= 0 ||
    long.quantityStep <= 0
  ) {
    return null;
  }
  const capacity = Math.min(short.size, long.size);
  const step = Math.max(short.quantityStep, long.quantityStep);
  const quantity = Math.floor(capacity / step + 1e-9) * step;
  return quantity >= Math.max(short.minQuantity, long.minQuantity) ? quantity : null;
}

function pickBestSameVenuePair(
  shortCandidates: VenueLegCandidate[],
  longCandidates: VenueLegCandidate[],
  nowMs: number,
): VenuePair | null {
  const longByVenue = new Map(longCandidates.map((candidate) => [candidate.venue, candidate]));
  let best: VenuePair | null = null;

  for (const short of shortCandidates) {
    const long = longByVenue.get(short.venue);
    if (
      !long ||
      short.netAfterFees == null ||
      long.netAfterFees == null ||
      short.asOfMs == null ||
      long.asOfMs == null ||
      short.settleCurrency == null ||
      short.settleCurrency !== long.settleCurrency ||
      short.inverse !== long.inverse ||
      short.asOfMs > nowMs ||
      long.asOfMs > nowMs ||
      nowMs - Math.min(short.asOfMs, long.asOfMs) > MAX_QUOTE_AGE_MS
    ) {
      continue;
    }
    const quoteSkewMs = Math.abs(short.asOfMs - long.asOfMs);
    if (quoteSkewMs > MAX_LEG_QUOTE_SKEW_MS) continue;
    const maxQuantity = executableQuantity(short, long);
    if (maxQuantity == null) continue;
    const netCredit = short.netAfterFees - long.netAfterFees;
    if (best == null || netCredit > best.netCredit) {
      best = { short, long, netCredit, maxQuantity, quoteSkewMs };
    }
  }
  return best;
}

// ── Signal math ────────────────────────────────────────────────────

interface ProbabilityResult {
  prob: number;
  method: 'real-world' | 'risk-neutral';
  sigma: number;
  drift: number | null;
}

// Probability of finishing in the profit zone of a credit spread.
// For a call-credit, profit ⇔ S_T < BE.
// For a put-credit,  profit ⇔ S_T > BE.
//
// Resolution order (when each input is available):
//   1. real-world     — physical drift μ and realized σ_RV (P-measure).
//   2. risk-neutral   — Black-76 N(±d₂) at breakeven IV (Q-measure).
function successProbability(
  kind: SpreadKind,
  spot: number,
  forward: number,
  breakeven: number,
  T: number,
  ivAtBreakeven: number | null,
  realWorld: RealWorldParams | undefined,
): ProbabilityResult | null {
  if (realWorld && T > 0 && spot > 0 && breakeven > 0 && realWorld.sigmaRV > 0) {
    const direction = kind === 'call-credit' ? 'below' : 'above';
    const prob = realWorldPop(direction, spot, breakeven, T, realWorld.drift, realWorld.sigmaRV);
    if (Number.isFinite(prob)) {
      return { prob, method: 'real-world', drift: realWorld.drift, sigma: realWorld.sigmaRV };
    }
  }

  if (ivAtBreakeven != null && ivAtBreakeven > 0 && T > 0 && forward > 0 && breakeven > 0) {
    const sigma = ivAtBreakeven;
    const direction = kind === 'call-credit' ? 'below' : 'above';
    const prob = black76Probability(direction, forward, breakeven, T, sigma);
    return { prob, method: 'risk-neutral', drift: null, sigma };
  }
  return null;
}

function expectedOptionPayoff(
  right: OptionRight,
  spot: number,
  strike: number,
  T: number,
  drift: number,
  sigma: number,
): number {
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(spot / strike) + (drift + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  const expectedSpot = spot * Math.exp(drift * T);
  return right === 'call'
    ? expectedSpot * normCdf(d1) - strike * normCdf(d2)
    : strike * normCdf(-d2) - expectedSpot * normCdf(-d1);
}

function expectedSpreadLiability(
  kind: SpreadKind,
  spot: number,
  forward: number,
  shortStrike: number,
  longStrike: number,
  T: number,
  method: ProbabilityResult['method'],
  drift: number | null,
  sigma: number,
): number {
  const right = rightForKind(kind);
  const shortOption = method === 'risk-neutral'
    ? black76Price(right, forward, shortStrike, T, sigma)
    : expectedOptionPayoff(right, spot, shortStrike, T, drift ?? 0, sigma);
  const longOption = method === 'risk-neutral'
    ? black76Price(right, forward, longStrike, T, sigma)
    : expectedOptionPayoff(right, spot, longStrike, T, drift ?? 0, sigma);
  return Math.max(0, shortOption - longOption);
}

// Minimum return on capital required to fire a SELL signal. Below this even
// a positive-EV trade isn't worth the buying-power tie-up. Sourced from
// vol-seller practitioner targets (≈25–33%); we use 10% so the gate accepts
// shorter-dated tickets where carry is mechanically smaller.
const ROC_GATE_NEUTRAL = 0.10;
const ROC_GATE_STRESS = 0.20;

export function rocGateForRegime(regime: RegimeLabel | null | undefined): number {
  if (regime === 'high-vol') return ROC_GATE_STRESS;
  return ROC_GATE_NEUTRAL;
}

function gateSignal(
  kind: SpreadKind,
  shortStrike: number,
  longStrike: number,
  shortPremium: number | null,
  longPremium: number | null,
  spot: number,
  forward: number,
  T: number,
  ivAtStrike: ((strike: number) => number | null) | undefined,
  realWorld: RealWorldParams | undefined,
  regimeDominant: RegimeLabel | null | undefined,
): SpreadSignal | null {
  if (shortPremium == null || longPremium == null) return null;
  const validStrikeOrder = kind === 'call-credit'
    ? longStrike > shortStrike
    : longStrike < shortStrike;
  if (!validStrikeOrder) return null;

  const netCredit = shortPremium - longPremium;
  const spreadWidth = Math.abs(longStrike - shortStrike);
  if (netCredit <= 0 || netCredit >= spreadWidth) return null;
  const maxProfit = netCredit;
  const maxLoss = spreadWidth - netCredit;

  const breakeven = kind === 'call-credit' ? shortStrike + netCredit : shortStrike - netCredit;
  const riskReward = maxProfit > 0 ? Math.min(maxLoss / maxProfit, 999.99) : 999.99;
  const ivBE = ivAtStrike ? ivAtStrike(breakeven) : null;
  const probability = successProbability(kind, spot, forward, breakeven, T, ivBE, realWorld);
  if (probability == null) return null;
  const { prob, method, drift, sigma } = probability;
  const liability = expectedSpreadLiability(
    kind,
    spot,
    forward,
    shortStrike,
    longStrike,
    T,
    method,
    drift,
    sigma,
  );
  const expectedValue = netCredit - liability;
  const roc = maxLoss > 0 ? expectedValue / maxLoss : 0;
  const rocGate = rocGateForRegime(regimeDominant);
  const regimeSuffix =
    regimeDominant === 'high-vol'
      ? ' [high-vol: gate 20%]'
      : regimeDominant === 'low-vol'
        ? ' [low-vol: gate 10%]'
        : '';

  let signal: TradingSignal;
  let reasoning: string;
  if (netCredit > 0 && expectedValue > 0 && roc >= rocGate) {
    signal = 'SELL';
    reasoning = `Favorable: EV $${expectedValue.toFixed(2)}, ROC ${(roc * 100).toFixed(1)}%, Success ${Math.round(prob * 100)}%${regimeSuffix}`;
  } else {
    signal = 'AVOID';
    reasoning = expectedValue <= 0
      ? `Negative EV: $${expectedValue.toFixed(2)} at ${Math.round(prob * 100)}% success${regimeSuffix}`
      : `Low ROC: ${(roc * 100).toFixed(1)}% (gate ${(rocGate * 100).toFixed(0)}%)${regimeSuffix}`;
  }

  return {
    signal,
    reasoning,
    netCredit,
    maxProfit,
    maxLoss,
    breakeven,
    riskReward,
    successProbability: prob,
    probabilityMethod: method,
    expectedValue,
    roc,
  };
}

// ── Surface-level (blended across venues) signal ───────────────────

function blendedSideIv(
  venues: Partial<Record<VenueId, VenueQuote>>,
  pick: (q: VenueQuote) => number | null,
): number | null {
  let sum = 0;
  let count = 0;
  for (const q of Object.values(venues)) {
    if (!q) continue;
    const v = pick(q);
    if (v == null || !Number.isFinite(v)) continue;
    sum += v;
    count += 1;
  }
  return count > 0 ? sum / count : null;
}

// Restricts a venues map to the `allowed` set. Returns the original map when
// no filter was provided so the surface signal still blends across everything
// the chain has when the user hasn't narrowed venues.
function filterVenues(
  venues: Partial<Record<VenueId, VenueQuote>>,
  allowed: readonly VenueId[],
): Partial<Record<VenueId, VenueQuote>> {
  if (allowed.length === 0) return venues;
  const out: Partial<Record<VenueId, VenueQuote>> = {};
  for (const v of allowed) {
    const q = venues[v];
    if (q) out[v] = q;
  }
  return out;
}

function computeSurfaceSignal(
  kind: SpreadKind,
  shortStrike: number,
  longStrike: number,
  shortSide: EnrichedStrike | null,
  longSide: EnrichedStrike | null,
  spot: number,
  forward: number,
  T: number,
  ivAtStrike: ((strike: number) => number | null) | undefined,
  realWorld: RealWorldParams | undefined,
  venuesFilter: readonly VenueId[],
  regimeDominant: RegimeLabel | null | undefined,
): SpreadSignal | null {
  if (!shortSide || !longSide) return null;
  const right = rightForKind(kind);
  const shortVenues = filterVenues(sideForKind(shortSide, kind).venues, venuesFilter);
  const longVenues = filterVenues(sideForKind(longSide, kind).venues, venuesFilter);

  const shortBidIv =
    blendedSideIv(shortVenues, (q) => q.bidIv) ?? blendedSideIv(shortVenues, (q) => q.markIv);
  const longAskIv =
    blendedSideIv(longVenues, (q) => q.askIv) ?? blendedSideIv(longVenues, (q) => q.markIv);

  if (shortBidIv == null || longAskIv == null) return null;

  const shortPremium = priceAtIv(right, forward, shortStrike, T, shortBidIv);
  const longPremium = priceAtIv(right, forward, longStrike, T, longAskIv);
  const fallbackIv = (shortBidIv + longAskIv) / 2;
  return gateSignal(
    kind,
    shortStrike,
    longStrike,
    shortPremium,
    longPremium,
    spot,
    forward,
    T,
    ivAtStrike ?? (() => fallbackIv),
    realWorld,
    regimeDominant,
  );
}

// ── Public API ─────────────────────────────────────────────────────

export function routeVerticalSpread(input: SpreadInput): RoutedSpreadAnalysis {
  const { kind, shortStrike, longStrike, strikes, spot, forward, T, venues, strikeByKey, ivAtStrike, realWorld, regimeDominant, nowMs = Date.now() } = input;
  const right = rightForKind(kind);
  const shortRow = findStrike(strikes, shortStrike, strikeByKey);
  const longRow = findStrike(strikes, longStrike, strikeByKey);
  const venueList = venueSet(shortRow, longRow, kind, venues);

  const shortCandidates = buildLegCandidates(shortRow, shortStrike, 'sell', kind, forward, T, venueList);
  const longCandidates = buildLegCandidates(longRow, longStrike, 'buy', kind, forward, T, venueList);

  const theoreticalShortBest = pickBestSell(shortCandidates);
  const theoreticalLongBest = pickBestBuy(longCandidates);
  const theoreticalIndependentNetCredit =
    theoreticalShortBest?.netAfterFees != null && theoreticalLongBest?.netAfterFees != null
      ? theoreticalShortBest.netAfterFees - theoreticalLongBest.netAfterFees
      : null;
  const pair = pickBestSameVenuePair(shortCandidates, longCandidates, nowMs);
  const shortBest = pair?.short ?? null;
  const longBest = pair?.long ?? null;

  const bestIvValues = [shortBest?.iv, longBest?.iv].filter(
    (value): value is number => value != null && value > 0,
  );
  const combinedFallbackIv = bestIvValues.length > 0
    ? bestIvValues.reduce((sum, value) => sum + value, 0) / bestIvValues.length
    : null;
  const combinedSignal = gateSignal(
    kind,
    shortStrike,
    longStrike,
    shortBest?.netAfterFees ?? null,
    longBest?.netAfterFees ?? null,
    spot,
    forward,
    T,
    ivAtStrike ?? (combinedFallbackIv == null ? undefined : () => combinedFallbackIv),
    realWorld,
    regimeDominant,
  );

  const surfaceSignal = computeSurfaceSignal(
    kind,
    shortStrike,
    longStrike,
    shortRow,
    longRow,
    spot,
    forward,
    T,
    ivAtStrike,
    realWorld,
    venueList,
    regimeDominant,
  );

  return {
    kind,
    shortStrike,
    longStrike,
    right,
    spreadWidth: Math.abs(longStrike - shortStrike),
    short: { best: shortBest, candidates: shortCandidates },
    long: { best: longBest, candidates: longCandidates },
    combinedSignal,
    surfaceSignal,
    routeVenue: pair?.short.venue ?? null,
    maxQuantity: pair?.maxQuantity ?? null,
    quoteSkewMs: pair?.quoteSkewMs ?? null,
    theoreticalIndependentNetCredit,
  };
}
