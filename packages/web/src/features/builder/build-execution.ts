import type { NormalizedOptionContract } from '@shared/common';
import type { VenueExecution } from './types';

export function contractToExecution(
  contract: NormalizedOptionContract,
  underlyingPrice: number,
): VenueExecution | null {
  const multiplier = contract.contractMultiplierBase;
  const nativeMin = contract.minQty;
  const nativeStep = contract.lotSize;
  const bidFees = contract.quote.estimatedBidFees;
  const askFees = contract.quote.estimatedAskFees;
  if (
    multiplier == null ||
    !Number.isFinite(multiplier) ||
    multiplier <= 0 ||
    nativeMin == null ||
    nativeStep == null ||
    bidFees == null ||
    askFees == null
  ) {
    return null;
  }
  const bidPrice = contract.quote.bid.usdPerBase ?? null;
  const askPrice = contract.quote.ask.usdPerBase ?? null;

  return {
    venue: contract.venue,
    available: (bidPrice != null && bidPrice > 0) || (askPrice != null && askPrice > 0),
    bidPrice,
    askPrice,
    markPrice: contract.quote.mark.usdPerBase ?? null,
    bidSize: contract.quote.bidSize == null ? null : contract.quote.bidSize * multiplier,
    askSize: contract.quote.askSize == null ? null : contract.quote.askSize * multiplier,
    iv: contract.greeks.markIv,
    delta: contract.greeks.delta,
    contractSize: 1,
    tickSize: contract.tickSize ?? 0,
    minQty: nativeMin * multiplier,
    bidMakerFeeUsd: bidFees.maker / multiplier,
    bidTakerFeeUsd: bidFees.taker / multiplier,
    askMakerFeeUsd: askFees.maker / multiplier,
    askTakerFeeUsd: askFees.taker / multiplier,
    settleCurrency: contract.inverse ? 'BTC' : 'USD',
    inverse: contract.inverse,
    underlyingPrice,
  };
}
