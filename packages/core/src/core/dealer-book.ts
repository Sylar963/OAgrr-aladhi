import type { OptionRight, VenueId } from '../types/common.js';

/**
 * Reconstructed dealer net position for one contract on one venue.
 * `dealerContracts` sign convention: + = dealer LONG the option (long gamma),
 * − = dealer SHORT the option (short gamma). Holds for both calls and puts.
 */
export interface DealerPosition {
  venue: VenueId;
  symbol: string;
  underlying: string;
  expiry: string;
  strike: number;
  optionType: OptionRight;
  dealerContracts: number;
  lastOi: number;
  lastSnapshotTs: number;
}

/** One observed open-interest point for a contract at a moment in time. */
export interface OiSnapshotInput {
  venue: VenueId;
  symbol: string;
  underlying: string;
  expiry: string;
  strike: number;
  optionType: OptionRight;
  openInterest: number;
  snapshotTs: number;
}

/** Synchronous lookup of the current book position, injected into computeGex. */
export type BookLookup = (venue: VenueId, symbol: string) => DealerPosition | undefined;

/** Sub-contract OI noise below this is treated as zero change. */
export const OI_EPSILON = 1e-6;

/**
 * Legacy-OI seed: reproduce the naive prior exactly. Dealers assumed long calls
 * (+OI) and short puts (−OI). Every later interval refines this via flow.
 */
export function bootstrapNaivePosition(snap: OiSnapshotInput): DealerPosition {
  const sign = snap.optionType === 'call' ? 1 : -1;
  return {
    venue: snap.venue,
    symbol: snap.symbol,
    underlying: snap.underlying,
    expiry: snap.expiry,
    strike: snap.strike,
    optionType: snap.optionType,
    dealerContracts: sign * snap.openInterest,
    lastOi: snap.openInterest,
    lastSnapshotTs: snap.snapshotTs,
  };
}

/**
 * Signed increment to dealerContracts for an OPENING interval (deltaOi > 0).
 * Assumption: the taker is the customer, the dealer is the passive side. So an
 * aggressive customer buy that raises OI makes the dealer SHORT the option.
 * When no flow was observed (or it nets exactly flat), fall back to the naive
 * prior sign for that increment.
 */
export function signOiDelta(params: {
  deltaOi: number;
  netFlow: number;
  hasFlow: boolean;
  optionType: OptionRight;
}): number {
  const mag = Math.abs(params.deltaOi);
  if (!params.hasFlow || params.netFlow === 0) {
    return params.optionType === 'call' ? mag : -mag;
  }
  return params.netFlow > 0 ? -mag : mag;
}

/**
 * Evolve a contract's dealer position over one snapshot interval.
 * - ΔOI ≈ 0  → churn, no change.
 * - ΔOI < 0  → net closing; scale the position toward zero by OI_now/OI_prev
 *              (sign preserved, magnitude shrinks). Keeps |dealer| ≤ OI.
 * - ΔOI > 0  → net opening; add signOiDelta(...).
 */
export function applyBookInterval(params: {
  prior: DealerPosition;
  snapshot: OiSnapshotInput;
  netFlow: number;
  hasFlow: boolean;
}): DealerPosition {
  const { prior, snapshot, netFlow, hasFlow } = params;
  const prevOi = prior.lastOi;
  const nowOi = snapshot.openInterest;
  const deltaOi = nowOi - prevOi;
  let dealer = prior.dealerContracts;

  if (Math.abs(deltaOi) < OI_EPSILON) {
    // no net OI change → no position change
  } else if (deltaOi < 0) {
    const scale = prevOi > OI_EPSILON ? nowOi / prevOi : 0;
    dealer = dealer * Math.max(0, scale);
  } else {
    dealer = dealer + signOiDelta({ deltaOi, netFlow, hasFlow, optionType: snapshot.optionType });
  }

  return {
    ...prior,
    dealerContracts: dealer,
    lastOi: nowOi,
    lastSnapshotTs: snapshot.snapshotTs,
  };
}
