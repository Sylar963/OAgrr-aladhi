import { price76 } from '@oggregator/core';
import type { NormalizedOptionContract } from '@oggregator/core';
import type {
  AlphaLottoCandidate,
  AlphaLottoScannerQuery,
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
  | 'missing_mark'
  | 'premium_cap'
  | 'outside_otm'
  | 'missing_market'
  | 'wide_spread'
  | 'stale_quote';

export interface ScannerMarketContext {
  indexPrice: number;
  forwardPrice: number;
  nowMs: number;
}

export type CandidateResult =
  | { candidate: AlphaLottoCandidate; skipReason: null }
  | { candidate: null; skipReason: ScannerSkipReason };

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
  markIv: number | null,
  tYears: number,
  market: ScannerMarketContext,
): AlphaLottoTarget[] {
  return TARGET_MULTIPLES.map((multiple) => {
    const targetMark = multiple * mark;
    const intrinsicBtcPrice = strike + targetMark;
    const solvedForward =
      markIv == null ? null : solveForwardForCallPrice(targetMark, strike, markIv, tYears);
    const black76BtcPrice =
      solvedForward == null
        ? null
        : solvedForward * (market.indexPrice / market.forwardPrice);

    return {
      multiple,
      targetMark,
      intrinsicBtcPrice,
      intrinsicMovePct: ((intrinsicBtcPrice - market.indexPrice) / market.indexPrice) * 100,
      black76BtcPrice,
      black76MovePct:
        black76BtcPrice == null
          ? null
          : ((black76BtcPrice - market.indexPrice) / market.indexPrice) * 100,
    };
  });
}

function buildShocks(strike: number, mark: number, indexPrice: number): AlphaLottoShock[] {
  return SHOCK_MOVES_PCT.map((movePct) => {
    const btcPrice = indexPrice * (1 + movePct / 100);
    const intrinsicValue = Math.max(btcPrice - strike, 0);
    return {
      movePct,
      btcPrice,
      intrinsicValue,
      intrinsicMultiple: intrinsicValue / mark,
    };
  });
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

  const mark = contract.quote.mark.usd;
  if (mark == null || mark <= 0) return { candidate: null, skipReason: 'missing_mark' };
  if (mark > config.premiumCap) return { candidate: null, skipReason: 'premium_cap' };

  const otmPct = ((contract.strike - market.indexPrice) / market.indexPrice) * 100;
  if (otmPct < config.minOtmPct || otmPct > config.maxOtmPct) {
    return { candidate: null, skipReason: 'outside_otm' };
  }

  const bid = contract.quote.bid.usd;
  const ask = contract.quote.ask.usd;
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
  const breakEvenPrice = contract.strike + mark;
  return {
    candidate: {
      instrument: contract.exchangeSymbol,
      expiry: contract.expiry,
      expiryTs: contract.expiryTs,
      dte,
      strike: contract.strike,
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
      contractsAtMark: Math.floor(config.buyingPower / mark),
      contractsAtAsk: Math.floor(config.buyingPower / ask),
      conservativeContracts: Math.floor(config.buyingPower / (ask * config.marginHaircut)),
      targets: buildTargets(contract.strike, mark, contract.greeks.markIv, tYears, market),
      shocks: buildShocks(contract.strike, mark, market.indexPrice),
      asOfMs,
    },
    skipReason: null,
  };
}

export function rankLottoCandidates(candidates: AlphaLottoCandidate[]): AlphaLottoCandidate[] {
  return candidates.sort((a, b) => {
    if (a.mark !== b.mark) return a.mark - b.mark;
    const aTenX = a.targets.find((target) => target.multiple === 10)?.black76MovePct ?? Infinity;
    const bTenX = b.targets.find((target) => target.multiple === 10)?.black76MovePct ?? Infinity;
    if (aTenX !== bTenX) return aTenX - bTenX;
    if (a.spreadPct !== b.spreadPct) return a.spreadPct - b.spreadPct;
    return a.strike - b.strike;
  });
}
