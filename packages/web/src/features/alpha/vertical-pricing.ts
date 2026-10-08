import type { EnrichedChainResponse, VenueId, VenueQuote } from '@shared/enriched';
import { black76Price, black76Probability, normCdf } from '@lib/analytics/blackScholes';

export type VerticalKind = 'call-credit' | 'put-credit' | 'call-debit' | 'put-debit';
export const VERTICAL_LABELS: Record<VerticalKind, string> = {
  'call-credit': 'Call credit',
  'put-credit': 'Put credit',
  'call-debit': 'Call debit',
  'put-debit': 'Put debit',
};
export interface SpreadScanInput {
  chain: EnrichedChainResponse;
  venues: readonly VenueId[];
  quantity: number;
  equity: number;
  riskPct: number;
  costReserve: number;
  forecast?: { movePct: number; volatility: number };
  nowMs: number;
}
export type VerticalStatus = 'review' | 'no-edge' | 'over-budget' | 'no-model';

/** Venue-agnostic economics of one vertical at the user's size. */
export interface VerticalEconomics {
  expiry: string;
  kind: VerticalKind;
  direction: 'bullish' | 'bearish';
  buyStrike: number;
  sellStrike: number;
  buySymbol: string;
  sellSymbol: string;
  quantity: number;
  grossPremium: number;
  entryFee: number;
  /** Standalone taker fee per leg; `entryFee` may be lower when a combo fee applies. */
  legFees: { sell: number; buy: number };
  costReserve: number;
  maxProfit: number;
  maxLoss: number;
  riskPct: number;
  breakeven: number;
  modelEdge: number | null;
  /** Model edge ÷ standard deviation of the expiry P&L under the same distribution. */
  edgeRatio: number | null;
  probability: number | null;
  model: 'market' | 'forecast';
  status: VerticalStatus;
  ageMs: number;
  capacity: number;
  roundTrip: number | null;
  /**
   * Inverse (coin-settled) pairs only: net premium after entry fees in the underlying,
   * positive when received. USD figures assume it is hedged at the expiry forward.
   */
  basePremium: number | null;
}
export interface RankedVertical extends VerticalEconomics {
  id: string;
}

export interface VerticalLeg {
  strike: number;
  quote: VenueQuote;
}
export interface PricingRules {
  requireSameSettlement: boolean;
  allowInverse: boolean;
  /** Total fee for both legs; receives per-unit taker fees. */
  combineFees: (buyFee: number, sellFee: number, quantity: number) => number;
  maxQuoteAgeMs: number;
  maxLegSkewMs: number;
}

export const LIVE_QUOTE_LIMITS = { maxQuoteAgeMs: 15_000, maxLegSkewMs: 2_000 } as const;
export interface ScanContext {
  input: SpreadScanInput;
  T: number;
  valid: boolean;
}
export type Rejector = (reason: string) => void;

export const INVALID_INPUT_REASON = 'Enter valid sizing and an unexpired expiry';

export const positive = (n: number | null | undefined): n is number =>
  n != null && Number.isFinite(n) && n > 0;
const nonnegative = (n: number | null | undefined): n is number =>
  n != null && Number.isFinite(n) && n >= 0;
const aligned = (q: number, step: number) => Math.abs(q / step - Math.round(q / step)) < 1e-7;

export const sumTakerFees: PricingRules['combineFees'] = (buyFee, sellFee, quantity) =>
  (buyFee + sellFee) * quantity;

/** Standard deviation of min(max(S_T, low), high) for lognormal S_T with mean `forward`. */
export function clampedStdev(
  forward: number,
  low: number,
  high: number,
  T: number,
  sigma: number,
): number {
  const v = sigma * Math.sqrt(T);
  // E[S^n; S > k] = F^n · e^{n(n−1)v²/2} · N((ln(F/k) + (n − ½)v²) / v)
  const above = (k: number, n: number) =>
    forward ** n *
    Math.exp((n * (n - 1) * v * v) / 2) *
    normCdf((Math.log(forward / k) + (n - 0.5) * v * v) / v);
  const pBelow = 1 - above(low, 0);
  const pAbove = above(high, 0);
  const m1 = low * pBelow + above(low, 1) - above(high, 1) + high * pAbove;
  const m2 = low * low * pBelow + above(low, 2) - above(high, 2) + high * high * pAbove;
  return Math.sqrt(Math.max(m2 - m1 * m1, 0));
}

export function scanContext(input: SpreadScanInput): ScanContext {
  const { chain, quantity, equity, riskPct, costReserve, nowMs } = input;
  const T = chain.expiryTs == null ? 0 : (chain.expiryTs - nowMs) / (365.25 * 86_400_000);
  const valid =
    positive(quantity) &&
    positive(equity) &&
    positive(riskPct) &&
    nonnegative(costReserve) &&
    T > 0;
  return { input, T, valid };
}

export function rejectionCounter(): { rejected: Record<string, number>; reject: Rejector } {
  const rejected: Record<string, number> = {};
  return {
    rejected,
    reject: (reason) => {
      rejected[reason] = (rejected[reason] ?? 0) + 1;
    },
  };
}

function pairIssue(
  buy: VenueQuote,
  sell: VenueQuote,
  input: SpreadScanInput,
  rules: PricingRules,
): string | null {
  const b = buy.execution;
  const s = sell.execution;
  if (!b || !s) return 'Missing execution metadata / fees';
  if ((b.inverse || s.inverse) && !rules.allowInverse)
    return 'Inverse settlement needs separate risk model';
  if (
    b.inverse !== s.inverse ||
    !b.settleCurrency ||
    !s.settleCurrency ||
    (rules.requireSameSettlement && b.settleCurrency !== s.settleCurrency)
  )
    return 'Settlement mismatch';
  if (b.inverse && (!positive(buy.underlyingPriceUsd) || !positive(sell.underlyingPriceUsd)))
    return 'Missing inverse conversion price';
  if (!positive(b.askUsd) || !positive(s.bidUsd)) return 'Missing buy ask / sell bid';
  if (!nonnegative(b.askTakerFeeUsd) || !nonnegative(s.bidTakerFeeUsd)) return 'Unknown entry fees';
  if ((positive(b.bidUsd) && b.bidUsd > b.askUsd) || (positive(s.askUsd) && s.bidUsd > s.askUsd))
    return 'Crossed leg quote';
  if (
    !positive(buy.asOfMs) ||
    !positive(sell.asOfMs) ||
    buy.asOfMs > input.nowMs ||
    sell.asOfMs > input.nowMs ||
    input.nowMs - Math.min(buy.asOfMs, sell.asOfMs) > rules.maxQuoteAgeMs
  )
    return 'Stale or missing timestamp';
  if (Math.abs(buy.asOfMs - sell.asOfMs) > rules.maxLegSkewMs) return 'Leg timestamps out of sync';
  if (
    !positive(b.minQuantity) ||
    !positive(s.minQuantity) ||
    !positive(b.quantityStep) ||
    !positive(s.quantityStep)
  )
    return 'Unknown size rules';
  if (
    input.quantity < Math.max(b.minQuantity, s.minQuantity) ||
    !aligned(input.quantity, b.quantityStep) ||
    !aligned(input.quantity, s.quantityStep)
  )
    return 'Quantity below minimum or off step';
  if (
    !positive(b.askSize) ||
    !positive(s.bidSize) ||
    input.quantity > Math.min(b.askSize, s.bidSize)
  )
    return 'Insufficient displayed size';
  return null;
}

export function priceVertical(
  ctx: ScanContext,
  right: 'call' | 'put',
  buyLeg: VerticalLeg,
  sellLeg: VerticalLeg,
  rules: PricingRules,
  reject: Rejector,
): VerticalEconomics | null {
  const { input, T } = ctx;
  const { chain, quantity, equity, riskPct, costReserve, nowMs } = input;
  const buy = buyLeg.quote;
  const sell = sellLeg.quote;
  const issue = pairIssue(buy, sell, input, rules);
  if (issue) {
    reject(issue);
    return null;
  }
  const b = buy.execution!;
  const s = sell.execution!;
  const buyStrike = buyLeg.strike;
  const sellStrike = sellLeg.strike;
  const debit = right === 'call' ? buyStrike < sellStrike : buyStrike > sellStrike;
  const kind: VerticalKind = `${right}-${debit ? 'debit' : 'credit'}`;
  const direction = kind === 'call-debit' || kind === 'put-credit' ? 'bullish' : 'bearish';
  const width = Math.abs(buyStrike - sellStrike);
  const gross = (s.bidUsd! - b.askUsd!) * quantity;
  const entryFee = rules.combineFees(b.askTakerFeeUsd!, s.bidTakerFeeUsd!, quantity);
  const cash = gross - entryFee - costReserve;
  const maxProfit = debit ? width * quantity + cash : cash;
  const maxLoss = debit ? -cash : width * quantity - cash;
  if (!positive(maxProfit) || !positive(maxLoss) || (debit ? gross >= 0 : gross <= 0)) {
    reject('No positive payoff after costs');
    return null;
  }
  const breakeven =
    (debit ? buyStrike : sellStrike) +
    ((right === 'call' ? 1 : -1) * (debit ? -cash : cash)) / quantity;
  const forwards = [buy.underlyingPriceUsd, sell.underlyingPriceUsd].filter(positive);
  const forward = forwards.length === 2 ? (forwards[0]! + forwards[1]!) / 2 : null;
  const forecastSigma = input.forecast?.volatility ?? null;
  const buySigma = forecastSigma ?? (positive(buy.markIv) ? buy.markIv : null);
  const sellSigma = forecastSigma ?? (positive(sell.markIv) ? sell.markIv : null);
  const breakevenSigma =
    Math.abs(breakeven - buyStrike) <= Math.abs(breakeven - sellStrike) ? buySigma : sellSigma;
  const expectedSpot = input.forecast
    ? (chain.stats.indexPriceUsd ?? 0) * (1 + input.forecast.movePct / 100)
    : forward;
  let modelEdge: number | null = null;
  let edgeRatio: number | null = null;
  let probability: number | null = null;
  if (
    positive(expectedSpot) &&
    positive(buySigma) &&
    positive(sellSigma) &&
    positive(breakevenSigma)
  ) {
    // Each leg at its own smile IV: one averaged IV misprices the far leg of a wide pair by
    // hundreds of dollars. The clamp keeps a non-monotone smile from implying an arbitrage value.
    const legValue =
      black76Price(right, expectedSpot, buyStrike, T, buySigma) -
      black76Price(right, expectedSpot, sellStrike, T, sellSigma);
    modelEdge =
      cash + quantity * Math.min(Math.max(legValue, debit ? 0 : -width), debit ? width : 0);
    probability = black76Probability(
      direction === 'bullish' ? 'above' : 'below',
      expectedSpot,
      breakeven,
      T,
      breakevenSigma,
    );
    const payoffStdev =
      quantity *
      clampedStdev(
        expectedSpot,
        Math.min(buyStrike, sellStrike),
        Math.max(buyStrike, sellStrike),
        T,
        breakevenSigma,
      );
    edgeRatio = payoffStdev > 0 ? modelEdge / payoffStdev : null;
    if (!Number.isFinite(modelEdge) || !Number.isFinite(probability)) {
      modelEdge = null;
      probability = null;
    }
    if (modelEdge == null || !Number.isFinite(edgeRatio)) edgeRatio = null;
  }
  const exitKnown =
    positive(b.bidUsd) &&
    positive(s.askUsd) &&
    nonnegative(b.bidTakerFeeUsd) &&
    nonnegative(s.askTakerFeeUsd);
  const roundTrip = exitKnown
    ? gross +
      (b.bidUsd! - s.askUsd!) * quantity -
      entryFee -
      rules.combineFees(b.bidTakerFeeUsd!, s.askTakerFeeUsd!, quantity)
    : null;
  const status: VerticalStatus =
    maxLoss > (equity * riskPct) / 100 + 1e-8
      ? 'over-budget'
      : modelEdge == null
        ? 'no-model'
        : modelEdge > 0
          ? 'review'
          : 'no-edge';
  return {
    expiry: chain.expiry,
    kind,
    direction,
    buyStrike,
    sellStrike,
    buySymbol: b.exchangeSymbol,
    sellSymbol: s.exchangeSymbol,
    quantity,
    grossPremium: gross,
    entryFee,
    legFees: { sell: s.bidTakerFeeUsd! * quantity, buy: b.askTakerFeeUsd! * quantity },
    costReserve,
    maxProfit,
    maxLoss,
    riskPct: (maxLoss / equity) * 100,
    breakeven,
    modelEdge,
    edgeRatio,
    probability,
    model: input.forecast ? 'forecast' : 'market',
    status,
    ageMs: nowMs - Math.min(buy.asOfMs!, sell.asOfMs!),
    capacity: Math.min(b.askSize!, s.bidSize!),
    roundTrip,
    basePremium: b.inverse && forward != null ? (gross - entryFee) / forward : null,
  };
}

export function rankCandidates(candidates: RankedVertical[]): void {
  candidates.sort(
    (a, b) =>
      Number(a.status === 'over-budget') - Number(b.status === 'over-budget') ||
      (b.edgeRatio ?? -Infinity) - (a.edgeRatio ?? -Infinity) ||
      (b.modelEdge ?? -Infinity) - (a.modelEdge ?? -Infinity) ||
      a.maxLoss - b.maxLoss ||
      a.id.localeCompare(b.id),
  );
}

/** Rows quoting `right` on `venue`, ready to be paired as legs. */
export function venueLegs(
  input: SpreadScanInput,
  venue: VenueId,
  right: 'call' | 'put',
): VerticalLeg[] {
  const legs: VerticalLeg[] = [];
  for (const row of input.chain.strikes) {
    const quote = row[right].venues[venue];
    if (positive(row.strike) && quote != null) legs.push({ strike: row.strike, quote });
  }
  return legs;
}

export function expiryPnl(candidate: VerticalEconomics, spot: number): number {
  const intrinsic = (strike: number) =>
    candidate.kind.startsWith('call') ? Math.max(spot - strike, 0) : Math.max(strike - spot, 0);
  return (
    candidate.grossPremium -
    candidate.entryFee -
    candidate.costReserve +
    candidate.quantity * (intrinsic(candidate.buyStrike) - intrinsic(candidate.sellStrike))
  );
}
