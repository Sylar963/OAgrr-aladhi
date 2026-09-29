import { cdf, price76 } from '@oggregator/core';
import type { NormalizedOptionContract } from '@oggregator/core';
import type {
  AlphaLottoCandidate,
  AlphaLottoScannerQuery,
  AlphaLottoScannerResponse,
  AlphaLottoShock,
  AlphaLottoTarget,
} from '@oggregator/protocol';

const DAY_MS = 86_400_000;
const YEAR_MS = 365 * DAY_MS;
const TARGET_MULTIPLES = [5, 10, 25] as const;
const SHOCK_MOVES_PCT = [10, 15, 20] as const;
const MAX_QUOTE_AGE_MS = 30_000;
// Targets assume the move lands halfway to expiry, not instantly with the full clock intact.
const TARGET_HORIZON_FRACTION = 0.5;

export type ScannerSkipReason =
  | 'not_call'
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

export interface ScannerMarketContext {
  indexPrice: number;
  forwardPrice: number;
  referenceSource: 'venue-forward' | 'spot-proxy';
  atmIv: number | null;
  nowMs: number;
}

export type CandidateResult =
  | { candidate: AlphaLottoCandidate; skipReason: null }
  | { candidate: null; skipReason: ScannerSkipReason };

type LegacyLottoCandidate = AlphaLottoCandidate & {
  contractsAtMark: number;
  contractsAtAsk: number;
  conservativeContracts: number;
  targets: Array<AlphaLottoTarget & {
    intrinsicBtcPrice: number;
    black76BtcPrice: number | null;
    black76MovePct: number | null;
  }>;
  shocks: Array<AlphaLottoShock & { btcPrice: number }>;
};

export type LegacyCompatibleLottoResponse = Omit<AlphaLottoScannerResponse, 'candidates'> & {
  venue: 'thalex';
  candidates: LegacyLottoCandidate[];
};

export function addLegacyLottoAliases(
  response: AlphaLottoScannerResponse,
): LegacyCompatibleLottoResponse {
  return {
    ...response,
    venue: 'thalex',
    candidates: response.candidates.map((candidate) => ({
      ...candidate,
      contractsAtMark: Math.floor(candidate.quantityAtMark),
      contractsAtAsk: Math.floor(candidate.quantityAtAsk),
      conservativeContracts: Math.floor(candidate.conservativeQuantity),
      targets: candidate.targets.map((target) => ({
        ...target,
        intrinsicBtcPrice: target.intrinsicUnderlyingPrice,
        black76BtcPrice: target.modelUnderlyingPrice,
        black76MovePct: target.modelMovePct,
      })),
      shocks: candidate.shocks.map((shock) => ({
        ...shock,
        btcPrice: shock.underlyingPrice,
      })),
    })),
  };
}

function solveForwardForCallPrice(
  targetPrice: number,
  strike: number,
  sigma: number,
  tYears: number,
): number | null {
  if (!(targetPrice > 0 && strike > 0 && sigma > 0 && tYears > 0)) return null;

  let low = 1;
  let high = Math.max(strike + targetPrice, strike * 1.25);
  while (price76(high, strike, sigma, tYears, 'call') < targetPrice && high < 100_000_000) {
    high *= 2;
  }
  if (price76(high, strike, sigma, tYears, 'call') < targetPrice) return null;

  for (let i = 0; i < 80; i++) {
    const mid = (low + high) / 2;
    if (price76(mid, strike, sigma, tYears, 'call') < targetPrice) {
      low = mid;
    } else {
      high = mid;
    }
  }
  return (low + high) / 2;
}

function probabilityAbove(level: number, spot: number, vol: number, tYears: number): number | null {
  if (!(level > 0 && spot > 0 && vol > 0 && tYears > 0)) return null;
  const sd = vol * Math.sqrt(tYears);
  return cdf((Math.log(spot / level) - 0.5 * sd * sd) / sd);
}

// Driftless GBM (log drift -σ²/2) first-passage probability of touching an upper barrier.
function touchProbability(level: number, spot: number, vol: number, tYears: number): number | null {
  if (!(level > 0 && spot > 0 && vol > 0 && tYears > 0)) return null;
  if (level <= spot) return 1;
  const sd = vol * Math.sqrt(tYears);
  const b = Math.log(level / spot);
  const nu = -0.5 * vol * vol;
  return Math.min(
    1,
    cdf((-b + nu * tYears) / sd) + Math.exp(-b) * cdf((-b - nu * tYears) / sd),
  );
}

function buildTargets(
  strike: number,
  entryPrice: number,
  contractSize: number,
  markIv: number | null,
  tYears: number,
  exitHaircut: number,
  market: ScannerMarketContext,
): AlphaLottoTarget[] {
  const horizonYears = tYears * TARGET_HORIZON_FRACTION;
  const remainingYears = tYears - horizonYears;
  const expectedMovePct =
    market.atmIv == null ? null : market.atmIv * Math.sqrt(horizonYears) * 100;

  return TARGET_MULTIPLES.map((multiple) => {
    const targetMark = multiple * entryPrice;
    const targetUnitPrice = targetMark / contractSize;
    const intrinsicUnderlyingPrice = strike + targetUnitPrice;
    const fairUnitPriceNeeded = targetUnitPrice / (1 - exitHaircut);
    const solvedForward =
      markIv == null
        ? null
        : solveForwardForCallPrice(fairUnitPriceNeeded, strike, markIv, remainingYears);
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
        ((intrinsicUnderlyingPrice - market.indexPrice) / market.indexPrice) * 100,
      modelUnderlyingPrice,
      modelMovePct,
      impliedMoveMultiple:
        modelMovePct == null || expectedMovePct == null || expectedMovePct <= 0
          ? null
          : modelMovePct / expectedMovePct,
      horizonDays: (horizonYears * YEAR_MS) / DAY_MS,
      exitHaircutPct: exitHaircut * 100,
      touchProbability:
        modelUnderlyingPrice == null || markIv == null
          ? null
          : touchProbability(modelUnderlyingPrice, market.indexPrice, markIv, horizonYears),
    };
  });
}

function buildShocks(
  strike: number,
  entryPrice: number,
  contractSize: number,
  indexPrice: number,
): AlphaLottoShock[] {
  return SHOCK_MOVES_PCT.map((movePct) => {
    const underlyingPrice = indexPrice * (1 + movePct / 100);
    const intrinsicValue = Math.max(underlyingPrice - strike, 0) * contractSize;
    return {
      movePct,
      underlyingPrice,
      intrinsicValue,
      intrinsicMultiple: intrinsicValue / entryPrice,
    };
  });
}

function premiumUsd(
  rawPremium: number | null,
  contract: NormalizedOptionContract,
  market: ScannerMarketContext,
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

export function computeLottoCandidate(
  contract: NormalizedOptionContract,
  market: ScannerMarketContext,
  config: AlphaLottoScannerQuery,
): CandidateResult {
  if (contract.right !== 'call') return { candidate: null, skipReason: 'not_call' };
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

  const otmPct = ((contract.strike - market.indexPrice) / market.indexPrice) * 100;
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
  const breakEvenPrice = contract.strike + entryCost / contractSize;
  // Selling at the bid gives up this share of fair value; mark sits near mid.
  const exitHaircut = (ask - bid) / (ask + bid);
  const markIv = contract.greeks.markIv;
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
      markIv,
      spreadPct,
      otmPct,
      breakEvenPrice,
      breakEvenMovePct: ((breakEvenPrice - market.indexPrice) / market.indexPrice) * 100,
      probabilityAboveBreakEven:
        markIv == null
          ? null
          : probabilityAbove(
              breakEvenPrice * (market.forwardPrice / market.indexPrice),
              market.forwardPrice,
              markIv,
              tYears,
            ),
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
        markIv,
        tYears,
        exitHaircut,
        market,
      ),
      shocks: buildShocks(contract.strike, entryCost, contractSize, market.indexPrice),
      asOfMs,
    },
    skipReason: null,
  };
}

export function rankLottoCandidates(candidates: AlphaLottoCandidate[]): AlphaLottoCandidate[] {
  return candidates.sort((a, b) => {
    const aTenX = a.targets.find((target) => target.multiple === 10)?.impliedMoveMultiple ?? Infinity;
    const bTenX = b.targets.find((target) => target.multiple === 10)?.impliedMoveMultiple ?? Infinity;
    if (aTenX !== bTenX) return aTenX - bTenX;
    if (a.spreadPct !== b.spreadPct) return a.spreadPct - b.spreadPct;
    if (a.mark !== b.mark) return a.mark - b.mark;
    return a.strike - b.strike;
  });
}

export function rankLottoCandidatesAcrossExpiries(
  candidates: AlphaLottoCandidate[],
  limit: number,
): AlphaLottoCandidate[] {
  const ranked = rankLottoCandidates(candidates);
  const byExpiry = new Map<string, AlphaLottoCandidate[]>();
  for (const candidate of ranked) {
    const expiryCandidates = byExpiry.get(candidate.expiry) ?? [];
    expiryCandidates.push(candidate);
    byExpiry.set(candidate.expiry, expiryCandidates);
  }

  for (const [expiry, expiryCandidates] of byExpiry) {
    const bySafety = [...expiryCandidates].sort(
      (a, b) =>
        a.breakEvenMovePct - b.breakEvenMovePct ||
        a.minimumOrderCost - b.minimumOrderCost ||
        a.spreadPct - b.spreadPct,
    );
    const mixed: AlphaLottoCandidate[] = [];
    const selected = new Set<AlphaLottoCandidate>();
    for (let index = 0; mixed.length < expiryCandidates.length; index += 1) {
      const safer = bySafety[index];
      if (safer != null && !selected.has(safer)) {
        mixed.push(safer);
        selected.add(safer);
      }
      const convex = expiryCandidates[index];
      if (convex != null && !selected.has(convex)) {
        mixed.push(convex);
        selected.add(convex);
      }
    }
    byExpiry.set(expiry, mixed);
  }

  const selected: AlphaLottoCandidate[] = [];
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
