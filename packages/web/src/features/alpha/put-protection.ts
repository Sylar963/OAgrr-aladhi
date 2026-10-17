import type { AlphaPutCandidate, AlphaPutHedge } from '@oggregator/protocol';

export type ProtectionStyle = 'tight' | 'balanced' | 'cheap';

export interface ProtectionChoice {
  style: ProtectionStyle;
  candidate: AlphaPutCandidate;
  hedge: AlphaPutHedge;
}

type Hedged = Omit<ProtectionChoice, 'style'>;

/** Expiry P&L of the held units plus the bought puts, negative for a loss. */
export function hedgedPnlAt(candidate: AlphaPutCandidate, hedge: AlphaPutHedge, price: number): number {
  const holding = hedge.targetQty * (price - candidate.indexPrice);
  const puts = hedge.coveredQty * Math.max(candidate.strike - price, 0);
  return holding + puts - hedge.cost;
}

export function buildProtectionChoices(
  candidates: AlphaPutCandidate[],
  expiry: string,
): ProtectionChoice[] {
  const hedged: Hedged[] = candidates.flatMap((candidate) =>
    candidate.expiry === expiry && candidate.hedge != null && candidate.hedge.contracts > 0
      ? [{ candidate, hedge: candidate.hedge }]
      : [],
  );
  if (hedged.length === 0) return [];

  const tight = [...hedged].sort(
    (left, right) =>
      left.hedge.maxLossPct - right.hedge.maxLossPct ||
      left.hedge.cost - right.hedge.cost,
  )[0]!;
  if (hedged.length === 1) return [{ ...tight, style: 'balanced' }];

  const cheap = hedged
    .filter((entry) => entry !== tight)
    .sort(
      (left, right) =>
        left.hedge.cost - right.hedge.cost ||
        left.hedge.maxLossPct - right.hedge.maxLossPct,
    )[0]!;

  const midpoint = (tight.candidate.otmPct + cheap.candidate.otmPct) / 2;
  const balanced = hedged
    .filter((entry) => entry !== tight && entry !== cheap)
    .sort(
      (left, right) =>
        Math.abs(left.candidate.otmPct - midpoint) - Math.abs(right.candidate.otmPct - midpoint) ||
        left.candidate.spreadPct - right.candidate.spreadPct,
    )[0];

  return [
    { ...tight, style: 'tight' },
    ...(balanced == null ? [] : [{ ...balanced, style: 'balanced' as const }]),
    { ...cheap, style: 'cheap' },
  ];
}

// One coin was the old default holding: $81k of BTC but $0.08 of DOGE. A planning example in
// dollars keeps every ticker comparable; the user's own holding replaces it per ticker.
const DEFAULT_HOLDING_USD = 10_000;

/** About $10k of the underlying at spot, rounded to the nearest 1-2-5 step in log terms. */
export function defaultHedgeQty(spotUsd: number | null | undefined): number | null {
  if (spotUsd == null || !Number.isFinite(spotUsd) || spotUsd <= 0) return null;
  const raw = DEFAULT_HOLDING_USD / spotUsd;
  const decade = 10 ** Math.floor(Math.log10(raw));
  const steps = [1, 2, 5, 10].map((step) => step * decade);
  const nearest = steps.reduce((best, step) =>
    Math.abs(Math.log(step / raw)) < Math.abs(Math.log(best / raw)) ? step : best,
  );
  return Number(nearest.toPrecision(6));
}
