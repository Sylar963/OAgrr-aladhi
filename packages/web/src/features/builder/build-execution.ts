import type { NormalizedOptionContract } from '@shared/common';
import type { VenueExecution } from './types';

export function contractToExecution(
  contract: NormalizedOptionContract,
  underlyingPrice: number,
): VenueExecution | null {
  const multiplier = contract.contractMultiplierBase;
  const nativeMin = contract.minQty;
  const nativeStep = contract.lotSize;
  const nativeTick = contract.tickSize;
  const bidFees = contract.quote.estimatedBidFees;
  const askFees = contract.quote.estimatedAskFees;
  if (
    !isPositiveFinite(multiplier) ||
    !isPositiveFinite(nativeMin) ||
    !isPositiveFinite(nativeStep) ||
    !isPositiveFinite(nativeTick) ||
    !contract.settle ||
    bidFees == null ||
    askFees == null ||
    !isNonnegativeFinite(bidFees.maker) ||
    !isNonnegativeFinite(bidFees.taker) ||
    !isNonnegativeFinite(askFees.maker) ||
    !isNonnegativeFinite(askFees.taker)
  ) {
    return null;
  }
  const minQuantity = nativeMin * multiplier;
  const quantityStep = nativeStep * multiplier;
  const bidMakerFeeUsd = bidFees.maker / multiplier;
  const bidTakerFeeUsd = bidFees.taker / multiplier;
  const askMakerFeeUsd = askFees.maker / multiplier;
  const askTakerFeeUsd = askFees.taker / multiplier;
  if (
    !isPositiveFinite(minQuantity) ||
    !isPositiveFinite(quantityStep) ||
    !isNonnegativeFinite(bidMakerFeeUsd) ||
    !isNonnegativeFinite(bidTakerFeeUsd) ||
    !isNonnegativeFinite(askMakerFeeUsd) ||
    !isNonnegativeFinite(askTakerFeeUsd)
  ) {
    return null;
  }
  const bidPrice = positiveOrNull(contract.quote.bid.usdPerBase);
  const askPrice = positiveOrNull(contract.quote.ask.usdPerBase);

  return {
    venue: contract.venue,
    available: (bidPrice != null && bidPrice > 0) || (askPrice != null && askPrice > 0),
    bidPrice,
    askPrice,
    markPrice: positiveOrNull(contract.quote.mark.usdPerBase),
    bidSize: baseSizeOrNull(contract.quote.bidSize, multiplier),
    askSize: baseSizeOrNull(contract.quote.askSize, multiplier),
    iv: contract.greeks.markIv,
    delta: contract.greeks.delta,
    contractSize: 1,
    tickSize: nativeTick,
    minQty: minQuantity,
    quantityStep,
    bidMakerFeeUsd,
    bidTakerFeeUsd,
    askMakerFeeUsd,
    askTakerFeeUsd,
    settleCurrency: contract.settle,
    inverse: contract.inverse,
    underlyingPrice,
  };
}

function isPositiveFinite(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value) && value > 0;
}

function isNonnegativeFinite(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function positiveOrNull(value: number | null | undefined): number | null {
  return isPositiveFinite(value) ? value : null;
}

function baseSizeOrNull(value: number | null, multiplier: number): number | null {
  if (value == null || !Number.isFinite(value) || value < 0) return null;
  const baseSize = value * multiplier;
  return Number.isFinite(baseSize) ? baseSize : null;
}
