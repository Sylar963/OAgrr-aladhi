import type { PnlAttribution } from '@oggregator/protocol';

import { price76 } from '../feeds/thalex/bs-solver.js';
import { yearsToExpiryAt } from './entry-iv.js';
import type { MarkContext, PositionLeg } from './types.js';

interface LegWithMark {
  leg: PositionLeg;
  mark: MarkContext;
}

interface LegSteps {
  entry: number;
  afterSpot: number;
  afterTime: number;
  afterVol: number;
}

// Entry IVs are solved against spot at the fill, so entry is valued on spot too;
// today's forward basis therefore lands in the spot step.
function revalue(leg: PositionLeg, mark: MarkContext): LegSteps | null {
  const entryUnderlying = leg.entryUnderlyingUsd;
  const entryIv = leg.entryIv;
  const forward = mark.forwardPriceUsd;
  const iv = mark.iv;
  const tNow = mark.yearsToExpiry;
  const tEntry = yearsToExpiryAt(leg.expiry, leg.entryTs);
  if (entryUnderlying == null || entryIv == null || !(entryIv > 0)) return null;
  if (forward == null || !(forward > 0) || iv == null || !(iv > 0)) return null;
  if (tNow == null || !(tNow > 0) || tEntry == null) return null;

  const { strike, optionRight } = leg;
  return {
    entry: price76(entryUnderlying, strike, entryIv, tEntry, optionRight),
    afterSpot: price76(forward, strike, entryIv, tEntry, optionRight),
    afterTime: price76(forward, strike, entryIv, tNow, optionRight),
    afterVol: price76(forward, strike, iv, tNow, optionRight),
  };
}

export function computePnlAttribution(legsWithMarks: LegWithMark[]): PnlAttribution | null {
  const out: PnlAttribution = {
    openPnlUsd: 0,
    spotUsd: 0,
    timeUsd: 0,
    volUsd: 0,
    otherUsd: 0,
    unattributedUsd: 0,
    attributedLegs: 0,
    totalLegs: 0,
  };

  for (const { leg, mark } of legsWithMarks) {
    if (mark.markPriceUsd == null) continue;
    const legPnl = (mark.markPriceUsd - leg.entryPriceUsd) * leg.size;
    out.openPnlUsd += legPnl;
    out.totalLegs += 1;

    const steps = revalue(leg, mark);
    if (steps == null) {
      out.unattributedUsd += legPnl;
      continue;
    }
    const spot = (steps.afterSpot - steps.entry) * leg.size;
    const time = (steps.afterTime - steps.afterSpot) * leg.size;
    const vol = (steps.afterVol - steps.afterTime) * leg.size;
    out.spotUsd += spot;
    out.timeUsd += time;
    out.volUsd += vol;
    out.otherUsd += legPnl - spot - time - vol;
    out.attributedLegs += 1;
  }

  return out.totalLegs === 0 ? null : out;
}
