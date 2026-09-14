import type { AlphaLottoCandidate } from '@oggregator/protocol';

export type OutcomeStyle = 'safer' | 'balanced' | 'moonshot';

export interface LottoOutcome {
  style: OutcomeStyle;
  candidate: AlphaLottoCandidate;
  quantity: number;
  spend: number;
  payout: number;
  profit: number;
  returnMultiple: number;
}

type PricedOutcome = Omit<LottoOutcome, 'style'>;

function quantityFor(candidate: AlphaLottoCandidate, budget: number): number {
  if (candidate.entryCost <= 0 || candidate.minQty <= 0 || candidate.askSize == null) return 0;
  const available = Math.min(candidate.askSize, budget / candidate.entryCost);
  const steps = Math.floor((available + Number.EPSILON) / candidate.minQty);
  return Number((steps * candidate.minQty).toFixed(8));
}

function priceOutcome(
  candidate: AlphaLottoCandidate,
  targetPrice: number,
  budget: number,
): PricedOutcome | null {
  const quantity = quantityFor(candidate, budget);
  if (quantity <= 0) return null;

  const spend = candidate.entryCost * quantity;
  const payout = Math.max(0, targetPrice - candidate.strike) * candidate.contractSize * quantity;
  if (payout <= spend) return null;

  return {
    candidate,
    quantity,
    spend,
    payout,
    profit: payout - spend,
    returnMultiple: payout / spend,
  };
}

function withStyle(outcome: PricedOutcome, style: OutcomeStyle): LottoOutcome {
  return { ...outcome, style };
}

export function buildLottoOutcomes(
  candidates: AlphaLottoCandidate[],
  targetPrice: number,
  budget: number,
  expiry: string,
): LottoOutcome[] {
  if (!Number.isFinite(targetPrice) || targetPrice <= 0 || !Number.isFinite(budget) || budget <= 0) {
    return [];
  }

  const priced = candidates.flatMap((candidate) => {
    if (candidate.expiry !== expiry) return [];
    const outcome = priceOutcome(candidate, targetPrice, budget);
    return outcome == null ? [] : [outcome];
  });
  if (priced.length === 0) return [];

  const bySafety = [...priced].sort(
    (left, right) =>
      left.candidate.breakEvenMovePct - right.candidate.breakEvenMovePct ||
      left.candidate.spreadPct - right.candidate.spreadPct,
  );
  const safer = bySafety[0];
  if (safer == null) return [];
  if (bySafety.length === 1) return [withStyle(safer, 'balanced')];

  const moonshot = [...priced]
    .filter((outcome) => outcome !== safer)
    .sort(
      (left, right) =>
        right.returnMultiple - left.returnMultiple ||
        left.candidate.spreadPct - right.candidate.spreadPct,
    )[0];
  if (moonshot == null) return [withStyle(safer, 'balanced')];

  if (bySafety.length === 2) {
    return [withStyle(safer, 'safer'), withStyle(moonshot, 'moonshot')];
  }

  const midpoint = (safer.candidate.breakEvenMovePct + moonshot.candidate.breakEvenMovePct) / 2;
  const balanced = priced
    .filter((outcome) => outcome !== safer && outcome !== moonshot)
    .sort(
      (left, right) =>
        Math.abs(left.candidate.breakEvenMovePct - midpoint) -
          Math.abs(right.candidate.breakEvenMovePct - midpoint) ||
        left.candidate.spreadPct - right.candidate.spreadPct,
    )[0];
  if (balanced == null) {
    return [withStyle(safer, 'safer'), withStyle(moonshot, 'moonshot')];
  }

  return [
    withStyle(safer, 'safer'),
    withStyle(balanced, 'balanced'),
    withStyle(moonshot, 'moonshot'),
  ];
}
