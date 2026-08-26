import { price76 } from '@oggregator/core';
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

function buildTargets(
  strike: number,
  mark: number,
  contractSize: number,
  markIv: number | null,
  tYears: number,
  market: ScannerMarketContext,
): AlphaLottoTarget[] {
  return TARGET_MULTIPLES.map((multiple) => {
    const targetMark = multiple * mark;
    const targetUnitPrice = targetMark / contractSize;
    const intrinsicUnderlyingPrice = strike + targetUnitPrice;
    const solvedForward =
      markIv == null ? null : solveForwardForCallPrice(targetUnitPrice, strike, markIv, tYears);
    const modelUnderlyingPrice =
      solvedForward == null
        ? null
        : solvedForward * (market.indexPrice / market.forwardPrice);
    const modelMovePct =
      modelUnderlyingPrice == null
        ? null
        : ((modelUnderlyingPrice - market.indexPrice) / market.indexPrice) * 100;
    const expectedMovePct =
      market.atmIv == null ? null : market.atmIv * Math.sqrt(tYears) * 100;

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
    };
  });
}

function buildShocks(
  strike: number,
  mark: number,
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
      intrinsicMultiple: intrinsicValue / mark,
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
  const breakEvenPrice = contract.strike + mark / contractSize;
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
      bidSize: contract.quote.bidSize,
      askSize: contract.quote.askSize,
      delta: contract.greeks.delta,
      markIv: contract.greeks.markIv,
      spreadPct,
      otmPct,
      breakEvenPrice,
      breakEvenMovePct: ((breakEvenPrice - market.indexPrice) / market.indexPrice) * 100,
      minimumOrderCost: ask * minQty,
      quantityAtMark: floorToIncrement(config.buyingPower / mark, minQty),
      quantityAtAsk: floorToIncrement(config.buyingPower / ask, minQty),
      conservativeQuantity: floorToIncrement(
        config.buyingPower / (ask * config.marginHaircut),
        minQty,
      ),
      targets: buildTargets(
        contract.strike,
        mark,
        contractSize,
        contract.greeks.markIv,
        tYears,
        market,
      ),
      shocks: buildShocks(contract.strike, mark, contractSize, market.indexPrice),
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
