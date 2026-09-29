import { price76 } from '@oggregator/core';
import type { NormalizedOptionContract } from '@oggregator/core';
import type {
  AlphaPutCandidate,
  AlphaPutHedge,
  AlphaPutProtection,
  AlphaPutScannerQuery,
  AlphaPutShock,
  AlphaPutTarget,
} from '@oggregator/protocol';

const DAY_MS = 86_400_000;
const YEAR_MS = 365 * DAY_MS;
const TARGET_MULTIPLES = [2, 5, 10] as const;
const SHOCK_MOVES_PCT = [-10, -20, -30] as const;
const MAX_QUOTE_AGE_MS = 30_000;

export type PutScannerSkipReason =
  | 'not_put'
  | 'missing_expiry'
  | 'outside_dte'
  | 'missing_market_reference'
  | 'missing_contract_economics'
  | 'missing_mark'
  | 'premium_cap'
  | 'outside_otm'
  | 'missing_market'
  | 'wide_spread'
  | 'stale_quote';

export interface PutScannerMarketContext {
  indexPrice: number;
  forwardPrice: number;
  referenceSource: 'venue-forward' | 'spot-proxy';
  atmIv: number | null;
  nowMs: number;
}

export type PutCandidateResult =
  | { candidate: AlphaPutCandidate; skipReason: null }
  | { candidate: null; skipReason: PutScannerSkipReason };

// Put value falls as the forward rises, so the bracket search runs over (0, strike).
function solveForwardForPutPrice(
  targetPrice: number,
  strike: number,
  sigma: number,
  tYears: number,
): number | null {
  if (!(targetPrice > 0 && targetPrice < strike && sigma > 0 && tYears > 0)) return null;

  let low = strike * 1e-6;
  let high = strike;
  if (price76(high, strike, sigma, tYears, 'put') >= targetPrice) {
    high = strike * 4;
    if (price76(high, strike, sigma, tYears, 'put') >= targetPrice) return null;
  }
  if (price76(low, strike, sigma, tYears, 'put') < targetPrice) return null;

  for (let i = 0; i < 80; i++) {
    const mid = (low + high) / 2;
    if (price76(mid, strike, sigma, tYears, 'put') > targetPrice) {
      low = mid;
    } else {
      high = mid;
    }
  }
  return (low + high) / 2;
}

function buildTargets(
  strike: number,
  entryPrice: number,
  contractSize: number,
  markIv: number | null,
  tYears: number,
  market: PutScannerMarketContext,
): AlphaPutTarget[] {
  const expectedMovePct =
    market.atmIv == null ? null : market.atmIv * Math.sqrt(tYears) * 100;
  return TARGET_MULTIPLES.map((multiple) => {
    const targetMark = multiple * entryPrice;
    const targetUnitPrice = targetMark / contractSize;
    const intrinsicUnderlyingPrice =
      targetUnitPrice < strike ? strike - targetUnitPrice : null;
    const solvedForward =
      markIv == null ? null : solveForwardForPutPrice(targetUnitPrice, strike, markIv, tYears);
    const modelUnderlyingPrice =
      solvedForward == null
        ? null
        : solvedForward * (market.indexPrice / market.forwardPrice);
    const modelMovePct =
      modelUnderlyingPrice == null
        ? null
        : ((modelUnderlyingPrice - market.indexPrice) / market.indexPrice) * 100;

    return {
      multiple,
      targetMark,
      intrinsicUnderlyingPrice,
      intrinsicMovePct:
        intrinsicUnderlyingPrice == null
          ? null
          : ((intrinsicUnderlyingPrice - market.indexPrice) / market.indexPrice) * 100,
      modelUnderlyingPrice,
      modelMovePct,
      impliedMoveMultiple:
        modelMovePct == null || expectedMovePct == null || expectedMovePct <= 0
          ? null
          : Math.abs(modelMovePct) / expectedMovePct,
    };
  });
}

function buildShocks(
  strike: number,
  entryPrice: number,
  contractSize: number,
  indexPrice: number,
): AlphaPutShock[] {
  return SHOCK_MOVES_PCT.map((movePct) => {
    const underlyingPrice = indexPrice * (1 + movePct / 100);
    const intrinsicValue = Math.max(strike - underlyingPrice, 0) * contractSize;
    return {
      movePct,
      underlyingPrice,
      intrinsicValue,
      intrinsicMultiple: intrinsicValue / entryPrice,
    };
  });
}

function buildProtection(
  strike: number,
  premiumPerUnit: number,
  dte: number,
  markIv: number | null,
  market: PutScannerMarketContext,
): AlphaPutProtection {
  const costPct = (premiumPerUnit / market.indexPrice) * 100;
  return {
    premiumPerUnit,
    costPct,
    annualizedCostPct: dte > 0 ? costPct * (365 / dte) : costPct,
    maxLossPct: ((market.indexPrice - strike + premiumPerUnit) / market.indexPrice) * 100,
    upsideBreakEvenPrice: market.indexPrice + premiumPerUnit,
    skewPremium: markIv == null || market.atmIv == null ? null : markIv - market.atmIv,
  };
}

function ceilToIncrement(value: number, increment: number): number {
  const units = Math.ceil(value / increment - 1e-9);
  return Number((units * increment).toFixed(8));
}

/**
 * Worst expiry outcome for `targetQty` units held at index plus the bought puts. The combined
 * P&L is linear below the strike, so the minimum sits at the strike when fully covered and at
 * zero otherwise.
 */
export function buildHedge(
  targetQty: number,
  strike: number,
  contractSize: number,
  minQty: number,
  entryCost: number,
  askSize: number | null,
  indexPrice: number,
): AlphaPutHedge | null {
  if (!(targetQty > 0)) return null;
  const wanted = ceilToIncrement(targetQty / contractSize, minQty);
  const available = askSize == null || askSize <= 0 ? 0 : askSize;
  const contracts =
    wanted <= available
      ? wanted
      : Number((Math.floor((available + Number.EPSILON) / minQty) * minQty).toFixed(8));
  const coveredQty = contracts * contractSize;
  const cost = entryCost * contracts;
  const fullyCovered = coveredQty + 1e-9 >= targetQty;
  const maxLoss = fullyCovered
    ? targetQty * (indexPrice - strike) + cost
    : targetQty * indexPrice - coveredQty * strike + cost;
  const holdingValue = targetQty * indexPrice;
  return {
    targetQty,
    contracts,
    coveredQty,
    cost,
    costPctOfHolding: (cost / holdingValue) * 100,
    maxLoss,
    maxLossPct: (maxLoss / holdingValue) * 100,
    fullyCovered,
  };
}

function premiumUsd(
  rawPremium: number | null,
  contract: NormalizedOptionContract,
  market: PutScannerMarketContext,
): number | null {
  if (rawPremium == null || rawPremium <= 0 || contract.contractSize == null) return null;
  const conversion = contract.inverse ? market.forwardPrice : 1;
  return rawPremium * conversion * contract.contractSize;
}

function floorToIncrement(value: number, increment: number): number {
  const units = Math.floor((value + Number.EPSILON) / increment);
  return Number((units * increment).toFixed(8));
}

function capToAskSize(quantity: number, askSize: number | null, increment: number): number {
  if (askSize == null || askSize <= 0) return 0;
  return floorToIncrement(Math.min(quantity, askSize), increment);
}

export function computePutCandidate(
  contract: NormalizedOptionContract,
  market: PutScannerMarketContext,
  config: AlphaPutScannerQuery,
): PutCandidateResult {
  if (contract.right !== 'put') return { candidate: null, skipReason: 'not_put' };
  if (contract.expiryTs == null) return { candidate: null, skipReason: 'missing_expiry' };

  const dte = (contract.expiryTs - market.nowMs) / DAY_MS;
  if (dte < config.minDte || dte > config.maxDte) {
    return { candidate: null, skipReason: 'outside_dte' };
  }
  if (!(market.indexPrice > 0 && market.forwardPrice > 0)) {
    return { candidate: null, skipReason: 'missing_market_reference' };
  }
  const contractSize = contract.contractSize;
  const minQty = contract.minQty;
  if (contractSize == null || contractSize <= 0 || minQty == null || minQty <= 0) {
    return { candidate: null, skipReason: 'missing_contract_economics' };
  }

  const mark = premiumUsd(contract.quote.mark.raw, contract, market);
  if (mark == null || mark <= 0) return { candidate: null, skipReason: 'missing_mark' };
  if (mark > config.premiumCap) return { candidate: null, skipReason: 'premium_cap' };

  const otmPct = ((market.indexPrice - contract.strike) / market.indexPrice) * 100;
  if (otmPct < config.minOtmPct || otmPct > config.maxOtmPct) {
    return { candidate: null, skipReason: 'outside_otm' };
  }

  const bid = premiumUsd(contract.quote.bid.raw, contract, market);
  const ask = premiumUsd(contract.quote.ask.raw, contract, market);
  if (bid == null || ask == null || bid <= 0 || ask <= 0 || ask < bid) {
    return { candidate: null, skipReason: 'missing_market' };
  }
  const spreadPct = ((ask - bid) / ((ask + bid) / 2)) * 100;
  if (spreadPct > config.maxSpreadPct) {
    return { candidate: null, skipReason: 'wide_spread' };
  }

  const asOfMs = contract.quote.timestamp;
  if (asOfMs == null || market.nowMs - asOfMs > MAX_QUOTE_AGE_MS) {
    return { candidate: null, skipReason: 'stale_quote' };
  }

  const tYears = (contract.expiryTs - market.nowMs) / YEAR_MS;
  const takerFee = contract.quote.estimatedAskFees?.taker ?? null;
  const entryCost = ask + (takerFee ?? 0);
  const premiumPerUnit = entryCost / contractSize;
  const breakEvenPrice = contract.strike - premiumPerUnit;
  const expectedMovePct =
    market.atmIv == null ? null : market.atmIv * Math.sqrt(tYears) * 100;
  const expectedMoveUsd =
    expectedMovePct == null ? null : market.indexPrice * expectedMovePct / 100;
  return {
    candidate: {
      venue: contract.venue,
      underlying: contract.base,
      instrument: contract.exchangeSymbol,
      settle: contract.settle,
      inverse: contract.inverse,
      contractSize,
      minQty,
      expiry: contract.expiry,
      expiryTs: contract.expiryTs,
      dte,
      strike: contract.strike,
      indexPrice: market.indexPrice,
      forwardPrice: market.forwardPrice,
      referenceSource: market.referenceSource,
      atmIv: market.atmIv,
      expectedMoveUsd,
      expectedMovePct,
      mark,
      bid,
      ask,
      takerFee,
      entryCost,
      bidSize: contract.quote.bidSize,
      askSize: contract.quote.askSize,
      delta: contract.greeks.delta,
      markIv: contract.greeks.markIv,
      spreadPct,
      otmPct,
      breakEvenPrice,
      breakEvenMovePct: ((breakEvenPrice - market.indexPrice) / market.indexPrice) * 100,
      minimumOrderCost: entryCost * minQty,
      quantityAtMark: floorToIncrement(config.buyingPower / mark, minQty),
      quantityAtAsk: capToAskSize(config.buyingPower / entryCost, contract.quote.askSize, minQty),
      conservativeQuantity: capToAskSize(
        config.buyingPower / (entryCost * config.marginHaircut),
        contract.quote.askSize,
        minQty,
      ),
      targets: buildTargets(
        contract.strike,
        entryCost,
        contractSize,
        contract.greeks.markIv,
        tYears,
        market,
      ),
      shocks: buildShocks(contract.strike, entryCost, contractSize, market.indexPrice),
      protection: buildProtection(
        contract.strike,
        premiumPerUnit,
        dte,
        contract.greeks.markIv,
        market,
      ),
      hedge: buildHedge(
        config.hedgeQty,
        contract.strike,
        contractSize,
        minQty,
        entryCost,
        contract.quote.askSize,
        market.indexPrice,
      ),
      asOfMs,
    },
    skipReason: null,
  };
}

function compareProtection(a: AlphaPutCandidate, b: AlphaPutCandidate): number {
  return (
    a.protection.maxLossPct - b.protection.maxLossPct ||
    a.protection.annualizedCostPct - b.protection.annualizedCostPct ||
    a.spreadPct - b.spreadPct
  );
}

function compareCost(a: AlphaPutCandidate, b: AlphaPutCandidate): number {
  return (
    a.protection.annualizedCostPct - b.protection.annualizedCostPct ||
    a.protection.maxLossPct - b.protection.maxLossPct ||
    a.spreadPct - b.spreadPct
  );
}

function compareConvexity(a: AlphaPutCandidate, b: AlphaPutCandidate): number {
  const aFiveX = a.targets.find((target) => target.multiple === 5)?.impliedMoveMultiple ?? Infinity;
  const bFiveX = b.targets.find((target) => target.multiple === 5)?.impliedMoveMultiple ?? Infinity;
  return (
    aFiveX - bFiveX ||
    a.spreadPct - b.spreadPct ||
    a.mark - b.mark ||
    b.strike - a.strike
  );
}

function compareSafety(a: AlphaPutCandidate, b: AlphaPutCandidate): number {
  return (
    b.breakEvenMovePct - a.breakEvenMovePct ||
    a.minimumOrderCost - b.minimumOrderCost ||
    a.spreadPct - b.spreadPct
  );
}

function orderings(rankBy: AlphaPutScannerQuery['rankBy']) {
  return rankBy === 'protection'
    ? { primary: compareProtection, secondary: compareCost }
    : { primary: compareConvexity, secondary: compareSafety };
}

export function rankPutCandidates(
  candidates: AlphaPutCandidate[],
  rankBy: AlphaPutScannerQuery['rankBy'],
): AlphaPutCandidate[] {
  return [...candidates].sort(orderings(rankBy).primary);
}

/**
 * Interleaves the two ends of each expiry (tight floors with cheap tails, or convex bets with
 * near breakevens) and then round-robins across expiries so a limit never starves one date.
 */
export function rankPutCandidatesAcrossExpiries(
  candidates: AlphaPutCandidate[],
  rankBy: AlphaPutScannerQuery['rankBy'],
  limit: number,
): AlphaPutCandidate[] {
  const { primary, secondary } = orderings(rankBy);
  const byExpiry = new Map<string, AlphaPutCandidate[]>();
  for (const candidate of [...candidates].sort(primary)) {
    const expiryCandidates = byExpiry.get(candidate.expiry) ?? [];
    expiryCandidates.push(candidate);
    byExpiry.set(candidate.expiry, expiryCandidates);
  }

  for (const [expiry, expiryCandidates] of byExpiry) {
    const bySecondary = [...expiryCandidates].sort(secondary);
    const mixed: AlphaPutCandidate[] = [];
    const selected = new Set<AlphaPutCandidate>();
    for (let index = 0; mixed.length < expiryCandidates.length; index += 1) {
      for (const candidate of [expiryCandidates[index], bySecondary[index]]) {
        if (candidate != null && !selected.has(candidate)) {
          mixed.push(candidate);
          selected.add(candidate);
        }
      }
    }
    byExpiry.set(expiry, mixed);
  }

  const selected: AlphaPutCandidate[] = [];
  for (let depth = 0; selected.length < limit; depth += 1) {
    let foundCandidate = false;
    for (const expiryCandidates of byExpiry.values()) {
      const candidate = expiryCandidates[depth];
      if (candidate == null) continue;
      selected.push(candidate);
      foundCandidate = true;
      if (selected.length === limit) break;
    }
    if (!foundCandidate) break;
  }
  return selected;
}
