import type {
  EnrichedChainResponse,
  EnrichedSide,
  EnrichedStrike,
  VenueId,
  VenueQuote,
} from '@shared/enriched';
import { delta as bsDelta } from '@lib/analytics/blackScholes';
import { formatExpiry } from '@lib/format';

export type XAxisMode = 'strike' | 'delta';
export type OtmSide = 'call' | 'put';

export const ATM_BLEND_HALF_WIDTH = 0.025;
export const MIN_IV = 0.05;
export const MAX_IV = 5;
export const SHORT_DATED_DTE = 2;
export const CROSS_MIN_IV_GAP = 0.0025;
export const FOCUS_TARGET_DTE = 30;
export const DEFAULT_STRIKE_BAND = 0.3;
export const DEFAULT_DELTA_DOMAIN: [number, number] = [0.03, 0.97];
const WING_TRIM_MONEYNESS = 0.15;
const YEAR_MS = 365.25 * 86_400_000;

export interface VenueIv {
  venue: VenueId;
  bidIv: number | null;
  markIv: number | null;
  askIv: number | null;
}

export interface VenueBest {
  iv: number;
  venue: VenueId;
}

export interface VenueCross {
  bidVenue: VenueId;
  askVenue: VenueId;
  bidUsd: number;
  askUsd: number;
  /** Best bid IV minus best ask IV (fraction). */
  ivGap: number;
}

export interface SmilePoint {
  strike: number;
  /** OTM contract that supplies bid/ask and venue dots (put below forward, call above). */
  side: OtmSide;
  /** OTM-blended mean mark IV across liquid venues (fraction); null when wing-trimmed. */
  markIv: number | null;
  /** |put delta| = 1 − Black-76 call delta; rises monotonically with strike. */
  x: number | null;
  /** Highest bid IV across venues for the OTM contract. */
  bestBid: VenueBest | null;
  /** Lowest ask IV across venues for the OTM contract. */
  bestAsk: VenueBest | null;
  /** One venue's bid above another's ask on the same contract, before fees. */
  cross: VenueCross | null;
  oiUsd: number;
  venues: VenueIv[];
}

export interface SmileCurve {
  expiry: string;
  label: string;
  dte: number;
  /** Fractional days to expiry from expiryTs; falls back to dte. */
  days: number;
  color: string;
  forward: number | null;
  atmIv: number | null;
  rr25: number | null;
  points: SmilePoint[];
}

// Sequential single-hue palette: light cyan (near-dated) → deep navy (long-dated).
export function tenorColor(idx: number, total: number): string {
  const t = total <= 1 ? 0 : idx / (total - 1);
  const hue = 180 + Math.round(t * 40);
  const saturation = 55 + Math.round(t * 10);
  const lightness = 72 - Math.round(t * 32);
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

export function withAlpha(hslColor: string, alpha: number): string {
  return hslColor.replace('hsl(', 'hsla(').replace(')', `, ${alpha})`);
}

// Mirrors core/enrichment.ts → buildEnrichedSide hasMarket gate. Without this,
// phantom quotes (no genuine bid/ask, no OI) inflate far-OTM averages and
// produce the 100%+ IV spikes on short-dated wings.
export function hasMarket(quote: VenueQuote): boolean {
  const hasQuotes = (quote.bid != null && quote.bid > 0) || (quote.ask != null && quote.ask > 0);
  const hasLiquidity =
    (quote.openInterest ?? 0) > 0 ||
    (quote.bid != null && quote.ask != null && quote.bid !== quote.ask);
  return hasQuotes && hasLiquidity;
}

function saneIv(v: number | null | undefined): number | null {
  if (v == null || !Number.isFinite(v) || v < MIN_IV || v > MAX_IV) return null;
  return v;
}

function liquidMarkAvg(side: EnrichedSide): number | null {
  let sum = 0;
  let count = 0;
  for (const quote of Object.values(side.venues)) {
    if (!quote || !hasMarket(quote)) continue;
    const v = saneIv(quote.markIv);
    if (v == null) continue;
    sum += v;
    count += 1;
  }
  return count > 0 ? sum / count : null;
}

export function blendOtm(
  strike: number,
  ref: number,
  callIv: number | null,
  putIv: number | null,
): number | null {
  if (callIv == null && putIv == null) return null;
  if (callIv == null) return putIv;
  if (putIv == null) return callIv;
  const lo = ref * (1 - ATM_BLEND_HALF_WIDTH);
  const hi = ref * (1 + ATM_BLEND_HALF_WIDTH);
  if (strike <= lo) return putIv;
  if (strike >= hi) return callIv;
  const w = (strike - lo) / (hi - lo);
  return (1 - w) * putIv + w * callIv;
}

// An averaged bid is not a tradable price; the executable market is the best
// bid and best ask across venues on the same contract.
//
// A cross must show up in IV AND in USD. Inverse (coin-settled) and linear
// venues convert to USD with different reference prices, so a USD-only cross
// is often conversion noise; each venue backs IV out of its own forward, so a
// sub-quarter-vol IV-only cross is rounding noise.
export function venueQuotes(side: EnrichedSide): {
  venues: VenueIv[];
  bestBid: VenueBest | null;
  bestAsk: VenueBest | null;
  cross: VenueCross | null;
  oiUsd: number;
} {
  const venues: VenueIv[] = [];
  const quotes = new Map<VenueId, VenueQuote>();
  let bestBid: VenueBest | null = null;
  let bestAsk: VenueBest | null = null;
  let oiUsd = 0;
  for (const [venue, quote] of Object.entries(side.venues) as Array<[VenueId, VenueQuote | undefined]>) {
    if (!quote) continue;
    oiUsd += quote.openInterestUsd ?? 0;
    if (!hasMarket(quote)) continue;
    const bidIv = quote.bid != null && quote.bid > 0 ? saneIv(quote.bidIv) : null;
    const askIv = quote.ask != null && quote.ask > 0 ? saneIv(quote.askIv) : null;
    const markIv = saneIv(quote.markIv);
    if (bidIv == null && askIv == null && markIv == null) continue;
    quotes.set(venue, quote);
    venues.push({ venue, bidIv, markIv, askIv });
    if (bidIv != null && (bestBid == null || bidIv > bestBid.iv)) bestBid = { iv: bidIv, venue };
    if (askIv != null && (bestAsk == null || askIv < bestAsk.iv)) bestAsk = { iv: askIv, venue };
  }
  return { venues, bestBid, bestAsk, cross: findCross(bestBid, bestAsk, quotes), oiUsd };
}

function findCross(
  bestBid: VenueBest | null,
  bestAsk: VenueBest | null,
  quotes: ReadonlyMap<VenueId, VenueQuote>,
): VenueCross | null {
  if (bestBid == null || bestAsk == null || bestBid.venue === bestAsk.venue) return null;
  const ivGap = bestBid.iv - bestAsk.iv;
  if (ivGap < CROSS_MIN_IV_GAP) return null;
  const bidUsd = quotes.get(bestBid.venue)?.bid;
  const askUsd = quotes.get(bestAsk.venue)?.ask;
  if (bidUsd == null || askUsd == null || bidUsd <= askUsd) return null;
  return { bidVenue: bestBid.venue, askVenue: bestAsk.venue, bidUsd, askUsd, ivGap };
}

export function timeToExpiryYears(
  expiryTs: number | null,
  dte: number,
  nowMs: number,
): number | null {
  if (expiryTs != null) {
    const remaining = expiryTs - nowMs;
    return remaining > 0 ? remaining / YEAR_MS : null;
  }
  return dte > 0 ? dte / 365.25 : null;
}

export function putDeltaAbs(
  forward: number,
  strike: number,
  T: number | null,
  iv: number | null,
): number | null {
  if (T == null || iv == null || forward <= 0 || strike <= 0) return null;
  const callDelta = bsDelta({ spot: forward, strike, T, r: 0, sigma: iv, right: 'call' });
  return Number.isFinite(callDelta) ? 1 - callDelta : null;
}

// Black-Scholes IV becomes ill-conditioned as option price approaches zero, so
// far-OTM short-dated wings can return mathematically real but visually noisy
// 100%+ IVs from a single venue. Drop a wing mark only if it sits well above
// the median of its neighbors AND it is in the wing region (>15% from forward).
function trimWingSpikes(points: SmilePoint[], ref: number): void {
  const marked = points.filter((p) => p.markIv != null);
  if (marked.length < 5) return;
  const rejected = new Set<SmilePoint>();
  for (let i = 0; i < marked.length; i++) {
    const p = marked[i]!;
    if (Math.abs(p.strike - ref) / ref < WING_TRIM_MONEYNESS) continue;
    const neighbors: number[] = [];
    for (let j = Math.max(0, i - 2); j < Math.min(marked.length, i + 3); j++) {
      if (j !== i) neighbors.push(marked[j]!.markIv!);
    }
    neighbors.sort((a, b) => a - b);
    const median = neighbors[Math.floor(neighbors.length / 2)]!;
    if (p.markIv! > median * 2) rejected.add(p);
  }
  for (const p of rejected) p.markIv = null;
}

export function buildSmilePoints(
  strikes: readonly EnrichedStrike[],
  forward: number | null,
  T: number | null,
): SmilePoint[] {
  const out: SmilePoint[] = [];
  for (const s of strikes) {
    const callIv = liquidMarkAvg(s.call);
    const putIv = liquidMarkAvg(s.put);
    const markIv =
      forward != null
        ? blendOtm(s.strike, forward, callIv, putIv)
        : callIv != null && putIv != null
          ? (callIv + putIv) / 2
          : (callIv ?? putIv);
    const side: OtmSide = forward != null && s.strike < forward ? 'put' : 'call';
    const q = venueQuotes(side === 'put' ? s.put : s.call);
    if (markIv == null && q.bestBid == null && q.bestAsk == null) continue;
    out.push({
      strike: s.strike,
      side,
      markIv,
      x: null,
      bestBid: q.bestBid,
      bestAsk: q.bestAsk,
      cross: q.cross,
      oiUsd: q.oiUsd,
      venues: q.venues,
    });
  }
  out.sort((a, b) => a.strike - b.strike);
  if (forward != null) {
    trimWingSpikes(out, forward);
    for (const p of out) {
      const iv =
        p.markIv ??
        (p.bestBid != null && p.bestAsk != null
          ? (p.bestBid.iv + p.bestAsk.iv) / 2
          : (p.bestBid?.iv ?? p.bestAsk?.iv ?? null));
      p.x = putDeltaAbs(forward, p.strike, T, iv);
    }
  }
  return out;
}

export function buildCurves(
  chains: readonly EnrichedChainResponse[],
  indexSpot: number | null,
  nowMs: number,
): SmileCurve[] {
  const sorted = chains.filter((c) => c.strikes.length > 5).sort((a, b) => a.dte - b.dte);
  return sorted
    .map((chain, i) => {
      const forward = chain.stats.forwardPriceUsd ?? indexSpot ?? null;
      const T = timeToExpiryYears(chain.expiryTs, chain.dte, nowMs);
      return {
        expiry: chain.expiry,
        label: formatExpiry(chain.expiry),
        dte: chain.dte,
        days: T != null ? T * 365.25 : chain.dte,
        color: tenorColor(i, sorted.length),
        forward,
        atmIv: chain.stats.atmIv,
        rr25: chain.stats.skew25d,
        points: buildSmilePoints(chain.strikes, forward, T),
      };
    })
    .filter((curve) => curve.points.filter((p) => p.markIv != null).length > 3);
}

export function isDefaultVisible(curve: Pick<SmileCurve, 'days'>): boolean {
  return curve.days >= SHORT_DATED_DTE;
}

export function defaultFocus(curves: readonly SmileCurve[]): string | null {
  let best: SmileCurve | null = null;
  for (const c of curves) {
    if (best == null || Math.abs(c.days - FOCUS_TARGET_DTE) < Math.abs(best.days - FOCUS_TARGET_DTE)) {
      best = c;
    }
  }
  return best?.expiry ?? null;
}

export function pointX(p: SmilePoint, mode: XAxisMode): number | null {
  return mode === 'strike' ? p.strike : p.x;
}

export function defaultXDomain(
  mode: XAxisMode,
  curves: readonly SmileCurve[],
  indexSpot: number | null,
): [number, number] | null {
  if (mode === 'delta') return DEFAULT_DELTA_DOMAIN;
  let lo = Infinity;
  let hi = -Infinity;
  for (const c of curves) {
    for (const p of c.points) {
      if (p.markIv == null) continue;
      lo = Math.min(lo, p.strike);
      hi = Math.max(hi, p.strike);
    }
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
  if (indexSpot != null) {
    lo = Math.max(lo, indexSpot * (1 - DEFAULT_STRIKE_BAND));
    hi = Math.min(hi, indexSpot * (1 + DEFAULT_STRIKE_BAND));
  }
  return lo < hi ? [lo, hi] : null;
}

function quantile(sorted: readonly number[], q: number): number {
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[idx]!;
}

// Y range follows what is on screen. Marks set the range (top capped at the
// 98th percentile so one stray wing can't flatten every other tenor); the
// focused curve's bid/ask may stretch it by at most 30% so wide wing asks clip
// instead of rescaling the chart.
export function computeYDomain(
  curves: readonly SmileCurve[],
  focused: SmileCurve | null,
  mode: XAxisMode,
  xDomain: readonly [number, number],
): [number, number] | null {
  const inX = (p: SmilePoint) => {
    const x = pointX(p, mode);
    return x != null && x >= xDomain[0] && x <= xDomain[1];
  };
  const marks: number[] = [];
  for (const c of curves) {
    for (const p of c.points) if (p.markIv != null && inX(p)) marks.push(p.markIv);
  }
  if (marks.length === 0) return null;
  marks.sort((a, b) => a - b);
  let lo = marks[0]!;
  let hi = marks.length >= 20 ? quantile(marks, 0.98) : marks[marks.length - 1]!;
  if (focused != null) {
    const span = Math.max(hi - lo, 0.02);
    const cap = hi + span * 0.3;
    const floor = Math.max(0, lo - span * 0.3);
    for (const p of focused.points) {
      if (!inX(p)) continue;
      if (p.bestBid != null) lo = Math.max(floor, Math.min(lo, p.bestBid.iv));
      if (p.bestAsk != null) hi = Math.min(cap, Math.max(hi, p.bestAsk.iv));
    }
  }
  const pad = Math.max((hi - lo) * 0.08, 0.005);
  return [Math.max(0, lo - pad), hi + pad];
}

export function niceTicks(min: number, max: number, target: number): number[] {
  if (!(max > min) || target < 1) return [];
  const raw = (max - min) / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1.5 ? 2 : 1) * mag;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) {
    out.push(Number(v.toPrecision(12)));
  }
  return out;
}

export const DELTA_TICKS: ReadonlyArray<{ x: number; label: string }> = [
  { x: 0.05, label: '5Δp' },
  { x: 0.1, label: '10Δp' },
  { x: 0.25, label: '25Δp' },
  { x: 0.5, label: 'ATM' },
  { x: 0.75, label: '25Δc' },
  { x: 0.9, label: '10Δc' },
  { x: 0.95, label: '5Δc' },
];

export function formatStrikeTick(v: number): string {
  if (Math.abs(v) >= 1000) {
    const k = v / 1000;
    return `${Number.isInteger(k) ? k.toFixed(0) : k.toFixed(1)}k`;
  }
  return String(v);
}

export function formatDays(days: number): string {
  return days < 1 ? `${Math.max(0, Math.round(days * 24))}h` : `${Math.round(days)}d`;
}

export function formatDeltaLabel(x: number): string {
  if (Math.abs(x - 0.5) < 0.005) return 'ATM';
  return x < 0.5 ? `${Math.round(x * 100)}Δp` : `${Math.round((1 - x) * 100)}Δc`;
}

export function medianSpreadVol(points: readonly SmilePoint[]): number | null {
  const spreads: number[] = [];
  for (const p of points) {
    if (p.bestBid != null && p.bestAsk != null && p.cross == null) {
      spreads.push(p.bestAsk.iv - p.bestBid.iv);
    }
  }
  if (spreads.length === 0) return null;
  spreads.sort((a, b) => a - b);
  return quantile(spreads, 0.5);
}

export function nearestPoint(
  points: readonly SmilePoint[],
  mode: XAxisMode,
  x: number,
): SmilePoint | null {
  let best: SmilePoint | null = null;
  let bestDist = Infinity;
  for (const p of points) {
    const px = pointX(p, mode);
    if (px == null) continue;
    const d = Math.abs(px - x);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best;
}
