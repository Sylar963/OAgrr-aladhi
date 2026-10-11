// Positioning aggregates for the Analytics page.
//
// Everything is computed from USD notional (`openInterestUsd`, `volume24hUsd`).
// Raw `openInterest` is in venue-native contract units (OKX/Gate count
// 0.01-BTC contracts, Deribit 1-BTC, Paradex base coin), so summing it across
// venues is meaningless.

import type { EnrichedChainResponse, EnrichedStrike, VenueQuote } from '@shared/enriched';

import { computeExpectedMove } from './oi-by-strike/oi-em-utils';
import { computeMaxPain } from './oi-by-strike/oi-heatmap-utils';

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
      const maxPain = computeMaxPain([chain]);
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

// Venues list different strike grids, so a shared ATM strike would drop most
// of them. Instead interpolate each venue's own OTM mark IV at the forward.
const ATM_BRACKET_MAX_REL = 0.1;

function otmIv(venue: string, row: EnrichedStrike, forward: number): number | null {
  const calls: Quotes = row.call.venues;
  const puts: Quotes = row.put.venues;
  const [primary, fallback] = row.strike < forward ? [puts, calls] : [calls, puts];
  const iv = primary[venue]?.markIv ?? fallback[venue]?.markIv ?? null;
  return iv != null && iv > 0 ? iv : null;
}

export function venueAtmIvs(chain: EnrichedChainResponse): Map<string, number> {
  const out = new Map<string, number>();
  const forward = chain.stats.forwardPriceUsd;
  if (forward == null || forward <= 0) return out;

  const below = new Map<string, { strike: number; iv: number }>();
  const above = new Map<string, { strike: number; iv: number }>();
  for (const row of chain.strikes) {
    if (Math.abs(row.strike - forward) / forward > ATM_BRACKET_MAX_REL) continue;
    const venues = new Set([...Object.keys(row.call.venues), ...Object.keys(row.put.venues)]);
    for (const venue of venues) {
      const iv = otmIv(venue, row, forward);
      if (iv == null) continue;
      const side = row.strike <= forward ? below : above;
      const prev = side.get(venue);
      if (prev == null || Math.abs(row.strike - forward) < Math.abs(prev.strike - forward)) {
        side.set(venue, { strike: row.strike, iv });
      }
    }
  }

  for (const [venue, lo] of below) {
    if (lo.strike === forward) {
      out.set(venue, lo.iv);
      continue;
    }
    const hi = above.get(venue);
    if (hi == null) continue;
    const span = hi.strike - lo.strike;
    const w = span > 0 ? (forward - lo.strike) / span : 0;
    out.set(venue, lo.iv + w * (hi.iv - lo.iv));
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
