import type { EnrichedChainResponse } from '@shared/enriched';

export type OiMode = 'contracts' | 'notional';

export interface VenueOi {
  venue: string;
  callOi: number;
  putOi: number;
}

export interface ExpiryOi {
  expiry: string;
  callOi: number;
  putOi: number;
}

export interface StrikeOi {
  strike: number;
  callOi: number;
  putOi: number;
  venues: VenueOi[];
  expiries: ExpiryOi[];
}

interface StrikeAcc {
  callOi: number;
  putOi: number;
  venues: Map<string, { callOi: number; putOi: number }>;
  expiries: Map<string, { callOi: number; putOi: number }>;
}

export function aggregateStrikeOi(
  chains: EnrichedChainResponse[],
  spotPrice: number | null,
  mode: OiMode,
): StrikeOi[] {
  const readOi = mode === 'notional'
    ? (q: { openInterestUsd: number | null } | undefined) => q?.openInterestUsd ?? 0
    : (q: { openInterest: number | null } | undefined) => q?.openInterest ?? 0;
  const map = new Map<number, StrikeAcc>();

  for (const chain of chains) {
    for (const strike of chain.strikes) {
      const prev = map.get(strike.strike) ?? { callOi: 0, putOi: 0, venues: new Map(), expiries: new Map() };
      const ep = prev.expiries.get(chain.expiry) ?? { callOi: 0, putOi: 0 };
      for (const [venue, q] of Object.entries(strike.call.venues)) {
        const val = readOi(q);
        prev.callOi += val;
        ep.callOi += val;
        const vp = prev.venues.get(venue) ?? { callOi: 0, putOi: 0 };
        vp.callOi += val;
        prev.venues.set(venue, vp);
      }
      for (const [venue, q] of Object.entries(strike.put.venues)) {
        const val = readOi(q);
        prev.putOi += val;
        ep.putOi += val;
        const vp = prev.venues.get(venue) ?? { callOi: 0, putOi: 0 };
        vp.putOi += val;
        prev.venues.set(venue, vp);
      }
      prev.expiries.set(chain.expiry, ep);
      map.set(strike.strike, prev);
    }
  }

  const band = spotPrice ? spotPrice * 0.3 : Infinity;
  return [...map.entries()]
    .filter(([strike]) => !spotPrice || Math.abs(strike - spotPrice) <= band)
    .filter(([, d]) => d.callOi > 0 || d.putOi > 0)
    .map(([strike, d]) => ({
      strike,
      callOi: d.callOi,
      putOi: d.putOi,
      venues: [...d.venues.entries()]
        .map(([venue, v]) => ({ venue, ...v }))
        .filter((v) => v.callOi > 0 || v.putOi > 0)
        .sort((a, b) => b.callOi + b.putOi - (a.callOi + a.putOi)),
      expiries: [...d.expiries.entries()]
        .map(([expiry, v]) => ({ expiry, ...v }))
        .filter((v) => v.callOi > 0 || v.putOi > 0)
        .sort((a, b) => b.callOi + b.putOi - (a.callOi + a.putOi)),
    }))
    .sort((a, b) => a.strike - b.strike);
}

export function computeMaxPain(chains: EnrichedChainResponse[]): number | null {
  const strikeOi = new Map<number, { callOi: number; putOi: number }>();
  for (const chain of chains) {
    for (const strike of chain.strikes) {
      const prev = strikeOi.get(strike.strike) ?? { callOi: 0, putOi: 0 };
      for (const q of Object.values(strike.call.venues)) prev.callOi += q?.openInterest ?? 0;
      for (const q of Object.values(strike.put.venues)) prev.putOi += q?.openInterest ?? 0;
      strikeOi.set(strike.strike, prev);
    }
  }

  const strikes = [...strikeOi.entries()];
  if (strikes.length === 0) return null;

  let minPayout = Infinity;
  let maxPainStrike: number | null = null;

  for (const [settlement] of strikes) {
    let totalPayout = 0;
    for (const [strike, oi] of strikes) {
      if (settlement > strike) totalPayout += (settlement - strike) * oi.callOi;
      if (settlement < strike) totalPayout += (strike - settlement) * oi.putOi;
    }
    if (totalPayout < minPayout) {
      minPayout = totalPayout;
      maxPainStrike = settlement;
    }
  }

  return maxPainStrike;
}
