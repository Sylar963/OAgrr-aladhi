import type { EnrichedChainResponse, EnrichedSide } from '@shared/enriched';

export const BE_TENOR_TARGETS = [15, 30] as const;
export type BeTenorTarget = (typeof BE_TENOR_TARGETS)[number];
export const OTM_STRANGLE_FRACTION = 0.25;

export interface ExpiryCandidate {
  expiry: string;
  expiryTs: number | null;
}

export interface StructureBreakevens {
  kind: 'atm_straddle' | 'otm_strangle';
  expiry: string;
  putStrike: number;
  callStrike: number;
  premiumUsd: number;
  lowerUsd: number;
  upperUsd: number;
  refSpotUsd: number;
}

function expiryMs(candidate: ExpiryCandidate): number {
  return candidate.expiryTs ?? Date.parse(`${candidate.expiry}T08:00:00Z`);
}

export function pickNearestExpiry(
  candidates: readonly ExpiryCandidate[],
  targetDays: number,
  nowMs: number,
): string | null {
  let best: string | null = null;
  let bestDist = Infinity;
  for (const candidate of candidates) {
    const ms = expiryMs(candidate);
    if (!Number.isFinite(ms) || ms <= nowMs) continue;
    const dist = Math.abs((ms - nowMs) / 86_400_000 - targetDays);
    if (dist < bestDist) {
      bestDist = dist;
      best = candidate.expiry;
    }
  }
  return best;
}

// Median, not mean, so one venue with a stale or crossed quote can't drag the level.
export function compositeMidUsd(side: EnrichedSide): number | null {
  const mids = Object.values(side.venues)
    .map((quote) => quote?.mid)
    .filter((mid): mid is number => mid != null && Number.isFinite(mid) && mid > 0)
    .sort((a, b) => a - b);
  if (mids.length === 0) return null;
  const mid = Math.floor(mids.length / 2);
  return mids.length % 2 === 1 ? mids[mid]! : (mids[mid - 1]! + mids[mid]!) / 2;
}

function refSpot(chain: EnrichedChainResponse): number | null {
  const spot = chain.stats.indexPriceUsd ?? chain.stats.forwardPriceUsd;
  return spot != null && Number.isFinite(spot) && spot > 0 ? spot : null;
}

function nearestPricedStrike(
  chain: EnrichedChainResponse,
  target: number,
  priced: (row: EnrichedChainResponse['strikes'][number]) => boolean,
): EnrichedChainResponse['strikes'][number] | null {
  let best: EnrichedChainResponse['strikes'][number] | null = null;
  for (const row of chain.strikes) {
    if (!priced(row)) continue;
    if (best == null || Math.abs(row.strike - target) < Math.abs(best.strike - target)) best = row;
  }
  return best;
}

export function atmStraddleBreakevens(chain: EnrichedChainResponse): StructureBreakevens | null {
  const spot = refSpot(chain);
  if (spot == null) return null;
  const row = nearestPricedStrike(
    chain,
    chain.stats.atmStrike ?? spot,
    (r) => compositeMidUsd(r.call) != null && compositeMidUsd(r.put) != null,
  );
  if (row == null) return null;
  const premiumUsd = compositeMidUsd(row.call)! + compositeMidUsd(row.put)!;
  return {
    kind: 'atm_straddle',
    expiry: chain.expiry,
    putStrike: row.strike,
    callStrike: row.strike,
    premiumUsd,
    lowerUsd: row.strike - premiumUsd,
    upperUsd: row.strike + premiumUsd,
    refSpotUsd: spot,
  };
}

export function otmStrangleBreakevens(
  chain: EnrichedChainResponse,
  otmFraction: number = OTM_STRANGLE_FRACTION,
): StructureBreakevens | null {
  const spot = refSpot(chain);
  if (spot == null) return null;
  const putRow = nearestPricedStrike(chain, spot * (1 - otmFraction), (r) => compositeMidUsd(r.put) != null);
  const callRow = nearestPricedStrike(chain, spot * (1 + otmFraction), (r) => compositeMidUsd(r.call) != null);
  if (putRow == null || callRow == null || putRow.strike >= callRow.strike) return null;
  const premiumUsd = compositeMidUsd(putRow.put)! + compositeMidUsd(callRow.call)!;
  return {
    kind: 'otm_strangle',
    expiry: chain.expiry,
    putStrike: putRow.strike,
    callStrike: callRow.strike,
    premiumUsd,
    lowerUsd: putRow.strike - premiumUsd,
    upperUsd: callRow.strike + premiumUsd,
    refSpotUsd: spot,
  };
}
