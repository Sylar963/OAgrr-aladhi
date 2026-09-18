import type { EnrichedChainResponse, VenueId, VenueQuote } from '@shared/enriched';
import { black76Price, black76Probability } from '@lib/analytics/blackScholes';

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
export interface SpreadCandidate {
  id: string;
  venue: VenueId;
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
  costReserve: number;
  maxProfit: number;
  maxLoss: number;
  riskPct: number;
  breakeven: number;
  modelEdge: number | null;
  probability: number | null;
  model: 'market' | 'forecast';
  status: 'review' | 'no-edge' | 'over-budget' | 'no-model';
  ageMs: number;
  capacity: number;
  roundTrip: number | null;
}
export interface VenueScan {
  venue: VenueId;
  candidates: SpreadCandidate[];
  rejected: Record<string, number>;
}

const positive = (n: number | null | undefined): n is number =>
  n != null && Number.isFinite(n) && n > 0;
const nonnegative = (n: number | null | undefined): n is number =>
  n != null && Number.isFinite(n) && n >= 0;
const aligned = (q: number, step: number) => Math.abs(q / step - Math.round(q / step)) < 1e-7;

function pairIssue(buy: VenueQuote, sell: VenueQuote, input: SpreadScanInput): string | null {
  const b = buy.execution;
  const s = sell.execution;
  if (!b || !s) return 'Missing execution metadata / fees';
  if (b.inverse || s.inverse) return 'Inverse settlement needs separate risk model';
  if (!b.settleCurrency || b.settleCurrency !== s.settleCurrency) return 'Settlement mismatch';
  if (!positive(b.askUsd) || !positive(s.bidUsd)) return 'Missing buy ask / sell bid';
  if (!nonnegative(b.askTakerFeeUsd) || !nonnegative(s.bidTakerFeeUsd)) return 'Unknown entry fees';
  if ((positive(b.bidUsd) && b.bidUsd > b.askUsd) || (positive(s.askUsd) && s.bidUsd > s.askUsd))
    return 'Crossed leg quote';
  if (
    !positive(buy.asOfMs) ||
    !positive(sell.asOfMs) ||
    buy.asOfMs > input.nowMs ||
    sell.asOfMs > input.nowMs ||
    input.nowMs - Math.min(buy.asOfMs, sell.asOfMs) > 15_000
  )
    return 'Stale or missing timestamp';
  if (Math.abs(buy.asOfMs - sell.asOfMs) > 2_000) return 'Leg timestamps differ by over 2s';
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

function fees(venue: VenueId, buyFee: number, sellFee: number, quantity: number): number {
  return venue === 'thalex'
    ? Math.max(0.0001, buyFee * quantity, sellFee * quantity)
    : (buyFee + sellFee) * quantity;
}

export function scanSpreads(input: SpreadScanInput): VenueScan[] {
  const { chain, quantity, equity, riskPct, costReserve, nowMs } = input;
  const T = chain.expiryTs == null ? 0 : (chain.expiryTs - nowMs) / (365.25 * 86_400_000);
  const valid =
    positive(quantity) &&
    positive(equity) &&
    positive(riskPct) &&
    nonnegative(costReserve) &&
    T > 0;
  return input.venues.map((venue) => {
    const result: VenueScan = { venue, candidates: [], rejected: {} };
    const reject = (reason: string) => {
      result.rejected[reason] = (result.rejected[reason] ?? 0) + 1;
    };
    if (!valid) {
      reject('Enter valid sizing and an unexpired expiry');
      return result;
    }
    for (const right of ['call', 'put'] as const) {
      const rows = chain.strikes.filter(
        (row) => positive(row.strike) && row[right].venues[venue] != null,
      );
      for (const buyRow of rows)
        for (const sellRow of rows) {
          if (buyRow.strike === sellRow.strike) continue;
          const buy = buyRow[right].venues[venue]!;
          const sell = sellRow[right].venues[venue]!;
          const issue = pairIssue(buy, sell, input);
          if (issue) {
            reject(issue);
            continue;
          }
          const b = buy.execution!;
          const s = sell.execution!;
          const debit =
            right === 'call' ? buyRow.strike < sellRow.strike : buyRow.strike > sellRow.strike;
          const kind: VerticalKind = `${right}-${debit ? 'debit' : 'credit'}`;
          const direction = kind === 'call-debit' || kind === 'put-credit' ? 'bullish' : 'bearish';
          const width = Math.abs(buyRow.strike - sellRow.strike);
          const gross = (s.bidUsd! - b.askUsd!) * quantity;
          const entryFee = fees(venue, b.askTakerFeeUsd!, s.bidTakerFeeUsd!, quantity);
          const cash = gross - entryFee - costReserve;
          const maxProfit = debit ? width * quantity + cash : cash;
          const maxLoss = debit ? -cash : width * quantity - cash;
          if (!positive(maxProfit) || !positive(maxLoss) || (debit ? gross >= 0 : gross <= 0)) {
            reject('No positive payoff after costs');
            continue;
          }
          const breakeven =
            (debit ? buyRow.strike : sellRow.strike) +
            ((right === 'call' ? 1 : -1) * (debit ? -cash : cash)) / quantity;
          const forwards = [buy.underlyingPriceUsd, sell.underlyingPriceUsd].filter(positive);
          const forward = forwards.length === 2 ? (forwards[0]! + forwards[1]!) / 2 : null;
          const ivs = [buy.markIv, sell.markIv].filter(positive);
          const sigma =
            input.forecast?.volatility ?? (ivs.length === 2 ? (ivs[0]! + ivs[1]!) / 2 : null);
          const expectedSpot = input.forecast
            ? (chain.stats.indexPriceUsd ?? 0) * (1 + input.forecast.movePct / 100)
            : forward;
          let modelEdge: number | null = null;
          let probability: number | null = null;
          if (positive(expectedSpot) && positive(sigma)) {
            // One lognormal distribution for both legs keeps the modeled vertical payoff bounded.
            modelEdge =
              cash +
              quantity *
                (black76Price(right, expectedSpot, buyRow.strike, T, sigma) -
                  black76Price(right, expectedSpot, sellRow.strike, T, sigma));
            probability = black76Probability(
              direction === 'bullish' ? 'above' : 'below',
              expectedSpot,
              breakeven,
              T,
              sigma,
            );
            if (!Number.isFinite(modelEdge) || !Number.isFinite(probability)) {
              modelEdge = null;
              probability = null;
            }
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
              fees(venue, b.bidTakerFeeUsd!, s.askTakerFeeUsd!, quantity)
            : null;
          const status =
            maxLoss > (equity * riskPct) / 100 + 1e-8
              ? 'over-budget'
              : modelEdge == null
                ? 'no-model'
                : modelEdge > 0
                  ? 'review'
                  : 'no-edge';
          result.candidates.push({
            id: `${venue}:${chain.expiry}:${kind}:${buyRow.strike}:${sellRow.strike}`,
            venue,
            expiry: chain.expiry,
            kind,
            direction,
            buyStrike: buyRow.strike,
            sellStrike: sellRow.strike,
            buySymbol: b.exchangeSymbol,
            sellSymbol: s.exchangeSymbol,
            quantity,
            grossPremium: gross,
            entryFee,
            costReserve,
            maxProfit,
            maxLoss,
            riskPct: (maxLoss / equity) * 100,
            breakeven,
            modelEdge,
            probability,
            model: input.forecast ? 'forecast' : 'market',
            status,
            ageMs: nowMs - Math.min(buy.asOfMs!, sell.asOfMs!),
            capacity: Math.min(b.askSize!, s.bidSize!),
            roundTrip,
          });
        }
    }
    if (result.candidates.length === 0 && Object.keys(result.rejected).length === 0)
      reject('No two strikes available on this venue');
    result.candidates.sort(
      (a, b) =>
        Number(a.status === 'over-budget') - Number(b.status === 'over-budget') ||
        (b.modelEdge ?? -Infinity) - (a.modelEdge ?? -Infinity) ||
        a.maxLoss - b.maxLoss ||
        a.id.localeCompare(b.id),
    );
    return result;
  });
}

export function expiryPnl(candidate: SpreadCandidate, spot: number): number {
  const intrinsic = (strike: number) =>
    candidate.kind.startsWith('call') ? Math.max(spot - strike, 0) : Math.max(strike - spot, 0);
  return (
    candidate.grossPremium -
    candidate.entryFee -
    candidate.costReserve +
    candidate.quantity * (intrinsic(candidate.buyStrike) - intrinsic(candidate.sellStrike))
  );
}
