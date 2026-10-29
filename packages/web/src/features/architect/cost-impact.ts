/** Spread share of max profit at or above which the Builder warns. Our choice, untested. */
export const SPREAD_WARN_SHARE = 0.25;
export const SPREAD_SEVERE_SHARE = 0.5;

export interface SpreadImpact {
  spreadCost: number;
  /** Max profit had every leg filled at mid. */
  maxProfitAtMid: number;
  /** Max profit opening at bid/ask: what the structure can still make after the spread. */
  maxProfitAfterSpread: number;
  /** Spread cost / max profit at mid; Infinity when there is no profit at mid. */
  share: number;
  severity: 'ok' | 'warn' | 'severe';
}

/**
 * How much of a bounded structure's max profit the bid/ask spread eats when it
 * is opened now. `maxProfitAtMarket` must come from legs priced at the same
 * bid/ask the spread cost was measured against: premium shifts the whole
 * expiry payoff by a constant, so max profit at mid is that plus the spread.
 */
export function spreadImpact(
  maxProfitAtMarket: number | null,
  spreadCost: number,
): SpreadImpact | null {
  if (maxProfitAtMarket == null || !(spreadCost > 0)) return null;
  const maxProfitAtMid = maxProfitAtMarket + spreadCost;
  const share = maxProfitAtMid > 0 ? spreadCost / maxProfitAtMid : Infinity;
  const severity =
    maxProfitAtMarket <= 0 || share >= SPREAD_SEVERE_SHARE
      ? 'severe'
      : share >= SPREAD_WARN_SHARE
        ? 'warn'
        : 'ok';
  return {
    spreadCost,
    maxProfitAtMid,
    maxProfitAfterSpread: maxProfitAtMarket,
    share,
    severity,
  };
}

export interface DebitSplit {
  /** Paid now. */
  debit: number;
  /** Comes back at expiry wherever the underlying settles. */
  guaranteedBack: number;
  /** The part that can actually be lost. */
  atRisk: number;
}

/**
 * A debit structure with a floor on its expiry value (ITM wings, boxes) pays
 * part of its debit for intrinsic that always returns. Splitting it shows the
 * real bet: an iron fly with ITM wings reads as "$78 debit" but risks $28.
 * `netPremium` is positive for a credit; `maxLoss` is the worst expiry P&L.
 */
export function debitSplit(netPremium: number, maxLoss: number | null): DebitSplit | null {
  if (!(netPremium < 0) || maxLoss == null) return null;
  const debit = -netPremium;
  const atRisk = Math.max(0, -maxLoss);
  const guaranteedBack = debit - atRisk;
  if (guaranteedBack < debit * 0.01) return null;
  return { debit, guaranteedBack, atRisk };
}
