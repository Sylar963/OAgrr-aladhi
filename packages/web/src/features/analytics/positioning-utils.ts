// Positioning aggregates for the Analytics page.
//
// Everything is computed from USD notional (`openInterestUsd`, `volume24hUsd`).
// Raw `openInterest` is in venue-native contract units (OKX/Gate count
// 0.01-BTC contracts, Deribit 1-BTC, Paradex base coin), so summing it across
// venues is meaningless. USD OI at one underlying price is proportional to
// base-coin quantity, which keeps max-pain rankings identical.

import type { EnrichedChainResponse, VenueQuote } from '@shared/enriched';

import { computeExpectedMove } from './oi-by-strike/oi-em-utils';

type Quotes = Partial<Record<string, VenueQuote>>;

function sumOiUsd(venues: Quotes): number {
  let total = 0;
  for (const q of Object.values(venues)) total += q?.openInterestUsd ?? 0;
  return total;
}

function sumVolUsd(venues: Quotes): number {
  let total = 0;
  for (const q of Object.values(venues)) total += q?.volume24hUsd ?? 0;
  return total;
}

function ratio(num: number, den: number): number | null {
  return den > 0 ? num / den : null;
}

// ── Summary ─────────────────────────────────────────────────────

export interface PositioningSummary {
  oiUsd: number;
  volUsd: number;
  pcOi: number | null;
  pcVol: number | null;
  turnover: number | null;
  nearOiUsd: number;
  nearOiShare: number | null;
}

export const NEAR_EXPIRY_DAYS = 7;

export function computeSummary(chains: EnrichedChainResponse[]): PositioningSummary {
  let callOi = 0;
  let putOi = 0;
  let callVol = 0;
  let putVol = 0;
  let nearOiUsd = 0;

  for (const chain of chains) {
    let chainOi = 0;
    for (const s of chain.strikes) {
      const c = sumOiUsd(s.call.venues);
      const p = sumOiUsd(s.put.venues);
      callOi += c;
      putOi += p;
      chainOi += c + p;
      callVol += sumVolUsd(s.call.venues);
      putVol += sumVolUsd(s.put.venues);
    }
    if (chain.dte <= NEAR_EXPIRY_DAYS) nearOiUsd += chainOi;
  }

  const oiUsd = callOi + putOi;
  const volUsd = callVol + putVol;
  return {
    oiUsd,
    volUsd,
    pcOi: ratio(putOi, callOi),
    pcVol: ratio(putVol, callVol),
    turnover: ratio(volUsd, oiUsd),
    nearOiUsd,
    nearOiShare: ratio(nearOiUsd, oiUsd),
  };
}

// ── Expiry calendar ─────────────────────────────────────────────

export interface ExpiryRow {
  expiry: string;
  dte: number;
  oiUsd: number;
  oiShare: number | null;
  pcOi: number | null;
  volUsd: number;
  turnover: number | null;
  maxPain: number | null;
  maxPainDistPct: number | null;
  expectedMove: number | null;
  expectedMovePct: number | null;
}

export function computeMaxPainUsd(chain: EnrichedChainResponse): number | null {
  const rows = chain.strikes
    .map((s) => ({ strike: s.strike, call: sumOiUsd(s.call.venues), put: sumOiUsd(s.put.venues) }))
    .filter((r) => r.call > 0 || r.put > 0);
  if (rows.length === 0) return null;

  let best: number | null = null;
  let minPayout = Infinity;
  for (const { strike: settle } of rows) {
    let payout = 0;
    for (const r of rows) {
      if (settle > r.strike) payout += (settle - r.strike) * r.call;
      else if (settle < r.strike) payout += (r.strike - settle) * r.put;
    }
    if (payout < minPayout) {
      minPayout = payout;
      best = settle;
    }
  }
  return best;
}

export function computeExpiryRows(
  chains: EnrichedChainResponse[],
  fallbackSpot: number | null,
): ExpiryRow[] {
  const partial = chains.map((chain) => {
    let callOi = 0;
    let putOi = 0;
    let volUsd = 0;
    for (const s of chain.strikes) {
      callOi += sumOiUsd(s.call.venues);
      putOi += sumOiUsd(s.put.venues);
      volUsd += sumVolUsd(s.call.venues) + sumVolUsd(s.put.venues);
    }
    return { chain, callOi, putOi, oiUsd: callOi + putOi, volUsd };
  });

  const totalOi = partial.reduce((acc, r) => acc + r.oiUsd, 0);

  return partial
    .filter((r) => r.oiUsd > 0 || r.volUsd > 0)
    .map(({ chain, callOi, putOi, oiUsd, volUsd }) => {
      const spot = chain.stats.forwardPriceUsd ?? fallbackSpot;
      const maxPain = computeMaxPainUsd(chain);
      const em = spot != null ? computeExpectedMove(chain, spot) : null;
      return {
        expiry: chain.expiry,
        dte: chain.dte,
        oiUsd,
        oiShare: ratio(oiUsd, totalOi),
        pcOi: ratio(putOi, callOi),
        volUsd,
        turnover: ratio(volUsd, oiUsd),
        maxPain,
        maxPainDistPct: maxPain != null && spot ? ((maxPain - spot) / spot) * 100 : null,
        expectedMove: em?.value ?? null,
        expectedMovePct: em && spot ? (em.value / spot) * 100 : null,
      };
    })
    .sort((a, b) => a.dte - b.dte);
}

// ── Largest positions ───────────────────────────────────────────

export interface TopPosition {
  expiry: string;
  dte: number;
  strike: number;
  right: 'call' | 'put';
  oiUsd: number;
  oiShare: number | null;
  volUsd: number;
  moneynessPct: number | null;
  topVenue: string | null;
  topVenueShare: number | null;
}

export function computeTopPositions(
  chains: EnrichedChainResponse[],
  spot: number | null,
  limit = 12,
): TopPosition[] {
  const all: Omit<TopPosition, 'oiShare'>[] = [];
  let totalOi = 0;

  for (const chain of chains) {
    for (const s of chain.strikes) {
      for (const right of ['call', 'put'] as const) {
        const venues = s[right].venues;
        const oiUsd = sumOiUsd(venues);
        if (oiUsd <= 0) continue;
        totalOi += oiUsd;

        let topVenue: string | null = null;
        let topOi = 0;
        for (const [venue, q] of Object.entries(venues)) {
          const v = q?.openInterestUsd ?? 0;
          if (v > topOi) {
            topOi = v;
            topVenue = venue;
          }
        }

        all.push({
          expiry: chain.expiry,
          dte: chain.dte,
          strike: s.strike,
          right,
          oiUsd,
          volUsd: sumVolUsd(venues),
          moneynessPct: spot ? ((s.strike - spot) / spot) * 100 : null,
          topVenue,
          topVenueShare: ratio(topOi, oiUsd),
        });
      }
    }
  }

  return all
    .sort((a, b) => b.oiUsd - a.oiUsd)
    .slice(0, limit)
    .map((p) => ({ ...p, oiShare: ratio(p.oiUsd, totalOi) }));
}

// ── Venues ──────────────────────────────────────────────────────

export interface VenueRow {
  venue: string;
  oiUsd: number;
  oiShare: number | null;
  volUsd: number;
  volShare: number | null;
  turnover: number | null;
  /** Mean ATM mark-IV gap to the cross-venue median, in vol points. */
  ivGapVp: number | null;
  ivGapSamples: number;
}

// Sub-2d ATM IV swings wildly between venues on settlement timing alone.
export const IV_GAP_MIN_DTE = 2;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function venueAtmIvs(chain: EnrichedChainResponse): Map<string, number> {
  const out = new Map<string, number>();
  const atm = chain.stats.atmStrike;
  if (atm == null) return out;
  const row = chain.strikes.find((s) => s.strike === atm);
  if (!row) return out;

  const byVenue = new Map<string, number[]>();
  for (const side of [row.call.venues, row.put.venues] as Quotes[]) {
    for (const [venue, q] of Object.entries(side)) {
      const iv = q?.markIv;
      if (iv == null || iv <= 0) continue;
      byVenue.set(venue, [...(byVenue.get(venue) ?? []), iv]);
    }
  }
  for (const [venue, ivs] of byVenue) {
    out.set(venue, ivs.reduce((a, b) => a + b, 0) / ivs.length);
  }
  return out;
}

export function computeVenueRows(chains: EnrichedChainResponse[]): VenueRow[] {
  const agg = new Map<string, { oi: number; vol: number; gapSum: number; gapN: number }>();
  const get = (venue: string) => {
    let entry = agg.get(venue);
    if (!entry) {
      entry = { oi: 0, vol: 0, gapSum: 0, gapN: 0 };
      agg.set(venue, entry);
    }
    return entry;
  };

  for (const chain of chains) {
    for (const s of chain.strikes) {
      for (const side of [s.call, s.put]) {
        for (const [venue, q] of Object.entries(side.venues)) {
          const entry = get(venue);
          entry.oi += q?.openInterestUsd ?? 0;
          entry.vol += q?.volume24hUsd ?? 0;
        }
      }
    }

    if (chain.dte < IV_GAP_MIN_DTE) continue;
    const ivs = venueAtmIvs(chain);
    if (ivs.size < 2) continue;
    const med = median([...ivs.values()]);
    for (const [venue, iv] of ivs) {
      const entry = get(venue);
      entry.gapSum += (iv - med) * 100;
      entry.gapN += 1;
    }
  }

  let totalOi = 0;
  let totalVol = 0;
  for (const e of agg.values()) {
    totalOi += e.oi;
    totalVol += e.vol;
  }

  return [...agg.entries()]
    .filter(([, e]) => e.oi > 0 || e.vol > 0)
    .map(([venue, e]) => ({
      venue,
      oiUsd: e.oi,
      oiShare: ratio(e.oi, totalOi),
      volUsd: e.vol,
      volShare: ratio(e.vol, totalVol),
      turnover: ratio(e.vol, e.oi),
      ivGapVp: e.gapN > 0 ? e.gapSum / e.gapN : null,
      ivGapSamples: e.gapN,
    }))
    .sort((a, b) => b.oiUsd - a.oiUsd);
}
