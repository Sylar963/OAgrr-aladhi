import type { EnrichedStrike, EnrichedSide, SmileCurve, SmilePoint, VenueQuote } from '@shared/enriched';

export type { SmileCurve, SmilePoint };

// Client-side mirror of core/enrichment.ts → computeSmile. Kept here because
// the enriched chain payload does not yet carry the smile curve — when the
// server starts emitting it, swap consumers to read response.smile and delete
// this module.

// Half-width of the put/call seam smoothing window, as a fraction of the forward.
// Inside [forward·(1−W), forward·(1+W)] we linearly mix put-side and call-side IVs
// instead of hard-switching at K=forward. W=0.025 spans ~3 strikes either side of
// the forward on typical BTC/ETH grids — enough to remove the discontinuity that
// would otherwise jump the breakeven-IV reading by a few tenths of a percent
// when a tight ATM spread's breakeven crosses the forward.
const ATM_BLEND_HALF_WIDTH = 0.025;

function avgIv(side: EnrichedSide, pick: (quote: VenueQuote) => number | null): number | null {
  let sum = 0;
  let count = 0;
  for (const quote of Object.values(side.venues)) {
    if (!quote) continue;
    const iv = pick(quote);
    if (iv == null || !Number.isFinite(iv) || iv <= 0) continue;
    sum += iv;
    count += 1;
  }
  return count > 0 ? sum / count : null;
}

function executableIv(quote: VenueQuote, leg: 'sell' | 'buy'): number | null {
  const execution = quote.execution;
  if (leg === 'sell') {
    return execution?.bidUsd != null &&
      execution.bidUsd > 0 &&
      execution.bidSize != null &&
      execution.bidSize > 0 &&
      execution.bidTakerFeeUsd != null
      ? quote.bidIv
      : null;
  }
  return execution?.askUsd != null &&
    execution.askUsd > 0 &&
    execution.askSize != null &&
    execution.askSize > 0 &&
    execution.askTakerFeeUsd != null
    ? quote.askIv
    : null;
}

function blendOtmIv(
  strike: number,
  forward: number,
  callIv: number | null,
  putIv: number | null,
): number | null {
  if (callIv == null && putIv == null) return null;
  if (callIv == null) return putIv;
  if (putIv == null) return callIv;

  const lo = forward * (1 - ATM_BLEND_HALF_WIDTH);
  const hi = forward * (1 + ATM_BLEND_HALF_WIDTH);
  if (strike <= lo) return putIv;
  if (strike >= hi) return callIv;
  const w = (strike - lo) / (hi - lo);
  return (1 - w) * putIv + w * callIv;
}

export function interpAtStrike(points: readonly SmilePoint[], targetStrike: number): number | null {
  if (points.length === 0) return null;
  const sorted = [...points].sort((a, b) => a.strike - b.strike);
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  if (targetStrike <= first.strike) return first.blendedIv;
  if (targetStrike >= last.strike) return last.blendedIv;
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const cur = sorted[i]!;
    if (targetStrike <= cur.strike) {
      if (prev.blendedIv == null || cur.blendedIv == null) return cur.blendedIv ?? prev.blendedIv;
      const span = cur.strike - prev.strike;
      if (span === 0) return cur.blendedIv;
      const t = (targetStrike - prev.strike) / span;
      return prev.blendedIv + t * (cur.blendedIv - prev.blendedIv);
    }
  }
  return null;
}

export function extractSmile(strikes: readonly EnrichedStrike[], forward: number): SmileCurve {
  const points: SmilePoint[] = strikes.map((s) => {
    const callIv = avgIv(s.call, (quote) => quote.markIv);
    const putIv = avgIv(s.put, (quote) => quote.markIv);
    const callBidIv = avgIv(s.call, (quote) => executableIv(quote, 'sell'));
    const putBidIv = avgIv(s.put, (quote) => executableIv(quote, 'sell'));
    const callAskIv = avgIv(s.call, (quote) => executableIv(quote, 'buy'));
    const putAskIv = avgIv(s.put, (quote) => executableIv(quote, 'buy'));
    const blended = blendOtmIv(s.strike, forward, callIv, putIv);
    return {
      strike: s.strike,
      moneyness: forward > 0 ? s.strike / forward : 0,
      callIv,
      putIv,
      blendedIv: blended,
      executableBidIv: blendOtmIv(s.strike, forward, callBidIv, putBidIv),
      executableAskIv: blendOtmIv(s.strike, forward, callAskIv, putAskIv),
    };
  });

  const atmIv = interpAtStrike(points, forward);
  const lowWing = interpAtStrike(points, forward * 0.9);
  const highWing = interpAtStrike(points, forward * 1.1);
  const skew =
    atmIv != null && atmIv > 0 && lowWing != null && highWing != null
      ? (lowWing - highWing) / atmIv
      : null;

  return { forward, points, atmIv, skew };
}
