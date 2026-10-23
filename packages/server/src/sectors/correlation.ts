import type { PerpCandle, PerpCandleSnapshot } from '@oggregator/core';
import type {
  CryptoSectorCorrelationPoint,
  CryptoSectorCorrelationResponse,
  CryptoSectorCorrelationSector,
  CryptoSectorCorrelationView,
  CryptoSectorRegime,
} from '@oggregator/protocol';
import { memberDef, type SectorBasketDef } from './baskets.js';

export const CORRELATION_WINDOW_BARS = 24;
/** Heatmap windows: 2h, 6h, 24h. */
export const VIEW_WINDOW_BARS = [24, 72, 288] as const;
const TIMELINE_BARS = 288;
const BARS_PER_HOUR = 12;
const MIN_ROW_SHARE = 0.75;
const MIN_SECTOR_COVERAGE = 0.75;
const MIN_SECTORS = 3;
// Calibrated on two weeks of Bybit 5m bars (Oct 2026): median 0.70, p10 0.50, p90 0.85.
const CORRELATED_AT = 0.8;
const DISPERSED_AT = 0.5;
// A regime is only left after crossing back past its threshold by this much, so `regimeSince`
// marks a real shift instead of the last tick around the line.
const HYSTERESIS = 0.05;
// A sector is decoupling when its gap to the market's mean correlation sits this many stdevs below
// its own norm and is material in absolute terms, while the market as a whole is not dispersed.
// Scoring the gap rather than the level keeps a market-wide loosening from flagging every sector.
const DECOUPLED_Z = -2;
const DECOUPLED_GAP = -0.15;
const POWER_ITERATIONS = 40;
const BTC = 'BTCUSDT';

interface CorrelationInput {
  snapshot: PerpCandleSnapshot;
  baskets: readonly SectorBasketDef[];
  /** Windows over closed bars never change; pass the same cache each call to compute only new ones. */
  cache?: CorrelationWindowCache;
}

export type CorrelationWindowCache = Map<number, WindowResult & { detailed: boolean }>;

interface WindowResult {
  point: CryptoSectorCorrelationPoint;
  /** Sector indices backing `matrix` rows/columns. */
  included: number[];
  matrix: number[][];
  /** Partial correlations given BTC; empty for summary windows or without BTC. */
  residualMatrix: number[][];
  corrBtc: (number | null)[];
  betaBtc: (number | null)[];
}

export function correlationSymbols(baskets: readonly SectorBasketDef[]): string[] {
  return [...new Set([BTC, ...baskets.flatMap((b) => b.members.map((m) => memberDef(m).bybit))])];
}

export function buildSectorCorrelation({
  snapshot,
  baskets,
  cache = new Map(),
}: CorrelationInput): CryptoSectorCorrelationResponse {
  const { barMs, lastClosedStart, series } = snapshot;
  let n = 0;
  for (const bars of series.values()) n = Math.max(n, bars.length);
  const gridStart = lastClosedStart - (n - 1) * barMs;

  let session: Uint8Array | undefined;
  const usSession = () => (session ??= usEquitySession(gridStart, barMs, n));

  const members = baskets.map((def) =>
    def.members.map(memberDef).flatMap((m) => {
      const bars = series.get(m.bybit);
      if (!bars) return [];
      const gate = m.session === 'us-equity' ? usSession() : undefined;
      return [logReturns(bars, gridStart, barMs, n, gate)];
    }),
  );
  const sectorReturns = baskets.map((def, s) =>
    basketReturns(members[s]!, n, Math.min(2, def.members.length)),
  );
  const btcBars = series.get(BTC);
  const btc = btcBars ? logReturns(btcBars, gridStart, barMs, n) : null;

  const history: WindowResult[] = [];
  const detailFrom = n - TIMELINE_BARS;
  const firstT = gridStart + CORRELATION_WINDOW_BARS * barMs + barMs;
  for (const t of cache.keys()) if (t < firstT) cache.delete(t);
  for (let end = CORRELATION_WINDOW_BARS; end < n; end++) {
    const t = gridStart + end * barMs + barMs;
    const detailed = end >= detailFrom;
    let window = cache.get(t);
    if (!window || (detailed && !window.detailed)) {
      window = {
        ...windowStats(sectorReturns, btc, end, t, CORRELATION_WINDOW_BARS, detailed),
        detailed,
      };
      cache.set(t, window);
    }
    history.push(window);
  }

  const latest = history[history.length - 1] ?? null;
  const current = latest && latest.point.avgCorr != null ? latest.point : null;

  const corrs = history.flatMap((h) => (h.point.avgCorr == null ? [] : [h.point.avgCorr]));
  const baseMean = corrs.length > 0 ? mean(corrs) : null;
  const std =
    baseMean != null && corrs.length > 1
      ? Math.sqrt(corrs.reduce((a, b) => a + (b - baseMean) ** 2, 0) / (corrs.length - 1))
      : null;

  let regime: CryptoSectorRegime | null = null;
  let regimeSince: number | null = null;
  for (const { point } of history) {
    const next = classify(regime, point.avgCorr);
    if (regime != null && next !== regime) regimeSince = point.t;
    regime = next;
  }

  const hourAgo = history[history.length - 1 - BARS_PER_HOUR]?.point.avgCorr ?? null;
  const ids = baskets.map((b) => b.id);
  const end = n - 1;
  const marketCoupled = current?.avgCorr != null && current.avgCorr > DISPERSED_AT;

  const sectors = baskets.map((def, s): CryptoSectorCorrelationSector => {
    const at = latest?.included.indexOf(s) ?? -1;
    const meanCorr = latest ? meanCorrToOthers(latest, s) : null;
    const gap = (h: WindowResult) => {
      const v = meanCorrToOthers(h, s);
      return v == null || h.point.avgCorr == null ? null : v - h.point.avgCorr;
    };
    const past = history.flatMap((h) => {
      const v = gap(h);
      return v == null ? [] : [v];
    });
    const nowGap = latest ? gap(latest) : null;
    const z = nowGap != null ? zScoreOf(nowGap, past) : null;
    return {
      id: def.id,
      name: def.name,
      corrBtc: at >= 0 ? (latest!.corrBtc[at] ?? null) : null,
      betaBtc: at >= 0 ? (latest!.betaBtc[at] ?? null) : null,
      intraCorr: end >= CORRELATION_WINDOW_BARS ? intraCorrelation(members[s]!, end) : null,
      meanCorr,
      gapZ: z,
      decoupled:
        marketCoupled && z != null && z <= DECOUPLED_Z && nowGap != null && nowGap <= DECOUPLED_GAP,
    };
  });

  const views = VIEW_WINDOW_BARS.map((bars): CryptoSectorCorrelationView => {
    const window =
      bars === CORRELATION_WINDOW_BARS
        ? latest
        : end >= bars
          ? windowStats(sectorReturns, btc, end, lastClosedStart + barMs, bars, true)
          : null;
    return toView(bars, ids.length, window);
  });

  return {
    asOf: n > 0 ? lastClosedStart + barMs : null,
    barSec: barMs / 1000,
    windowBars: CORRELATION_WINDOW_BARS,
    thresholds: { correlated: CORRELATED_AT, dispersed: DISPERSED_AT },
    regime: current ? regime : null,
    regimeSince: current ? regimeSince : null,
    current,
    change1h: current?.avgCorr != null && hourAgo != null ? current.avgCorr - hourAgo : null,
    baseline: { mean: baseMean, std, windows: corrs.length },
    zScore:
      current?.avgCorr != null && baseMean != null && std != null && std > 0
        ? (current.avgCorr - baseMean) / std
        : null,
    sectorIds: ids,
    views,
    sectors,
    timeline: history.slice(-TIMELINE_BARS).map((h) => h.point),
  };
}

/** Expands a window's included-sector matrices to the full sector order, null where excluded. */
function toView(
  windowBars: number,
  size: number,
  window: WindowResult | null,
): CryptoSectorCorrelationView {
  const blank = () => Array.from({ length: size }, () => new Array<number | null>(size).fill(null));
  const matrix = blank();
  const residualMatrix = blank();
  const corrBtc = new Array<number | null>(size).fill(null);
  window?.included.forEach((si, a) => {
    corrBtc[si] = window.corrBtc[a] ?? null;
    window.included.forEach((sj, b) => {
      matrix[si]![sj] = window.matrix[a]![b]!;
      residualMatrix[si]![sj] = window.residualMatrix[a]?.[b] ?? null;
    });
  });
  return { windowBars, matrix, residualMatrix, corrBtc };
}

function meanCorrToOthers(window: WindowResult, sector: number): number | null {
  const at = window.included.indexOf(sector);
  const k = window.included.length;
  if (at < 0 || k < 2) return null;
  let sum = 0;
  for (let b = 0; b < k; b++) if (b !== at) sum += window.matrix[at]![b]!;
  return sum / (k - 1);
}

function zScoreOf(value: number, sample: readonly number[]): number | null {
  if (sample.length < 2) return null;
  const mu = mean(sample);
  const sd = Math.sqrt(sample.reduce((a, v) => a + (v - mu) ** 2, 0) / (sample.length - 1));
  return sd > 0 ? (value - mu) / sd : null;
}

function classify(prev: CryptoSectorRegime | null, value: number | null): CryptoSectorRegime | null {
  if (value == null) return prev;
  if (prev === 'correlated' && value >= CORRELATED_AT - HYSTERESIS) return 'correlated';
  if (prev === 'dispersed' && value <= DISPERSED_AT + HYSTERESIS) return 'dispersed';
  if (value >= CORRELATED_AT) return 'correlated';
  if (value <= DISPERSED_AT) return 'dispersed';
  return 'mixed';
}

/** NYSE regular session by bar start (09:30–16:00 ET, weekdays). Exchange holidays are not modelled. */
function usEquitySession(gridStart: number, barMs: number, n: number): Uint8Array {
  const open = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const t = gridStart + i * barMs;
    const local = new Date(t - nyUtcOffsetHours(t) * 3_600_000);
    const weekday = local.getUTCDay();
    const minute = local.getUTCHours() * 60 + local.getUTCMinutes();
    open[i] = weekday !== 0 && weekday !== 6 && minute >= 570 && minute < 960 ? 1 : 0;
  }
  return open;
}

/** Hours New York is behind UTC: DST runs from the 2nd Sunday of March to the 1st Sunday of November, 2am local. */
function nyUtcOffsetHours(t: number): number {
  const year = new Date(t).getUTCFullYear();
  const dstStart = nthSundayUtc(year, 2, 2) + 7 * 3_600_000;
  const dstEnd = nthSundayUtc(year, 10, 1) + 6 * 3_600_000;
  return t >= dstStart && t < dstEnd ? 4 : 5;
}

function nthSundayUtc(year: number, month: number, nth: number): number {
  const firstDay = new Date(Date.UTC(year, month, 1)).getUTCDay();
  return Date.UTC(year, month, 1 + ((7 - firstDay) % 7) + (nth - 1) * 7);
}

/** Returns on the bar grid; bars without a trade, after a gap, or out of session stay NaN. */
function logReturns(
  bars: readonly PerpCandle[],
  gridStart: number,
  barMs: number,
  n: number,
  inSession?: Uint8Array,
): Float64Array {
  const out = new Float64Array(n).fill(Number.NaN);
  for (let k = 1; k < bars.length; k++) {
    const prev = bars[k - 1]!;
    const bar = bars[k]!;
    if (bar.start - prev.start !== barMs || !(bar.volume > 0)) continue;
    const i = (bar.start - gridStart) / barMs;
    if (i < 0 || i >= n || (inSession && !inSession[i])) continue;
    out[i] = Math.log(bar.close / prev.close);
  }
  return out;
}

function basketReturns(members: readonly Float64Array[], n: number, minMembers: number): Float64Array {
  const out = new Float64Array(n).fill(Number.NaN);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    let count = 0;
    for (const r of members) {
      const v = r[i]!;
      if (Number.isFinite(v)) {
        sum += v;
        count++;
      }
    }
    if (count >= minMembers) out[i] = sum / count;
  }
  return out;
}

function windowStats(
  sectors: readonly Float64Array[],
  btc: Float64Array | null,
  end: number,
  t: number,
  bars: number,
  /** Older windows only feed the baselines and regime; skip the BTC/eigen work. */
  detailed: boolean,
): WindowResult {
  const from = end - bars + 1;
  const empty: WindowResult = {
    point: { t, avgCorr: null, residualCorr: null, pc1Share: null, dispersion: null },
    included: [],
    matrix: [],
    residualMatrix: [],
    corrBtc: [],
    betaBtc: [],
  };

  const covered: number[] = [];
  for (let s = 0; s < sectors.length; s++) {
    let have = 0;
    for (let i = from; i <= end; i++) if (Number.isFinite(sectors[s]![i]!)) have++;
    if (have >= bars * MIN_SECTOR_COVERAGE) covered.push(s);
  }
  const rows: number[] = [];
  for (let i = from; i <= end; i++) {
    if (btc && !Number.isFinite(btc[i]!)) continue;
    if (covered.every((s) => Number.isFinite(sectors[s]![i]!))) rows.push(i);
  }
  if (rows.length < bars * MIN_ROW_SHARE) return empty;

  const included: number[] = [];
  const z: Float64Array[] = [];
  const sd: number[] = [];
  const totals: number[] = [];
  for (const s of covered) {
    const col = standardize(sectors[s]!, rows);
    if (!col) continue;
    included.push(s);
    z.push(col.z);
    sd.push(col.sd);
    totals.push(col.mean * rows.length);
  }
  const k = included.length;
  if (k < MIN_SECTORS) return empty;

  const matrix = Array.from({ length: k }, () => new Array<number>(k).fill(1));
  for (let a = 0; a < k; a++) {
    for (let b = a + 1; b < k; b++) {
      const r = dot(z[a]!, z[b]!);
      matrix[a]![b] = r;
      matrix[b]![a] = r;
    }
  }

  const avgCorr = meanOffDiagonal(matrix);
  if (!detailed) return { ...empty, point: { ...empty.point, avgCorr }, included, matrix };

  const zb = btc ? standardize(btc, rows) : null;
  const corrBtc = z.map((col) => (zb ? dot(col, zb.z) : null));
  const betaBtc = corrBtc.map((r, a) => (r != null && zb ? (r * sd[a]!) / zb.sd : null));

  // Correlation of residuals after regressing each sector on BTC is the partial correlation.
  let residualCorr: number | null = null;
  const residualMatrix: number[][] = [];
  if (zb) {
    let sum = 0;
    let pairs = 0;
    for (let a = 0; a < k; a++) residualMatrix.push(new Array<number>(k).fill(1));
    for (let a = 0; a < k; a++) {
      for (let b = a + 1; b < k; b++) {
        const ra = corrBtc[a]!;
        const rb = corrBtc[b]!;
        const denom = Math.sqrt((1 - ra * ra) * (1 - rb * rb));
        const r = denom > 1e-9 ? (matrix[a]![b]! - ra * rb) / denom : 0;
        residualMatrix[a]![b] = r;
        residualMatrix[b]![a] = r;
        if (denom > 1e-9) {
          sum += r;
          pairs++;
        }
      }
    }
    residualCorr = pairs > 0 ? sum / pairs : null;
  }

  const totalMean = mean(totals);
  return {
    point: {
      t,
      avgCorr,
      residualCorr,
      pc1Share: largestEigenvalue(matrix) / k,
      dispersion: Math.sqrt(totals.reduce((acc, v) => acc + (v - totalMean) ** 2, 0) / k),
    },
    included,
    matrix,
    residualMatrix,
    corrBtc,
    betaBtc,
  };
}

/** z-scores of `values` at `rows`, with the mean and population stdev; null for a flat series. */
function standardize(
  values: ArrayLike<number>,
  rows: readonly number[],
): { z: Float64Array; mean: number; sd: number } | null {
  const m = rows.length;
  let mu = 0;
  for (let j = 0; j < m; j++) mu += values[rows[j]!]!;
  mu /= m;
  let ss = 0;
  for (let j = 0; j < m; j++) ss += (values[rows[j]!]! - mu) ** 2;
  if (!(ss > 0)) return null;
  const sd = Math.sqrt(ss / m);
  const z = new Float64Array(m);
  for (let j = 0; j < m; j++) z[j] = (values[rows[j]!]! - mu) / sd;
  return { z, mean: mu, sd };
}

function dot(a: Float64Array, b: Float64Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s / a.length;
}

/** Mean pairwise correlation between members over the window ending at `end`, pairwise-complete. */
function intraCorrelation(members: readonly Float64Array[], end: number): number | null {
  const from = end - CORRELATION_WINDOW_BARS + 1;
  const values: number[] = [];
  for (let a = 0; a < members.length; a++) {
    for (let b = a + 1; b < members.length; b++) {
      const xs: number[] = [];
      const ys: number[] = [];
      for (let i = from; i <= end; i++) {
        const x = members[a]![i]!;
        const y = members[b]![i]!;
        if (Number.isFinite(x) && Number.isFinite(y)) {
          xs.push(x);
          ys.push(y);
        }
      }
      if (xs.length < CORRELATION_WINDOW_BARS * MIN_ROW_SHARE) continue;
      const r = pearson(xs, ys);
      if (r != null) values.push(r);
    }
  }
  return values.length > 0 ? values.reduce((s, v) => s + v, 0) / values.length : null;
}

function mean(x: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i]!;
  return s / x.length;
}

function pearson(x: readonly number[], y: readonly number[]): number | null {
  const rows = x.map((_, i) => i);
  const zx = standardize(x, rows);
  const zy = standardize(y, rows);
  return zx && zy ? dot(zx.z, zy.z) : null;
}

function meanOffDiagonal(m: readonly number[][]): number | null {
  const k = m.length;
  if (k < 2) return null;
  let s = 0;
  for (let a = 0; a < k; a++) for (let b = a + 1; b < k; b++) s += m[a]![b]!;
  return s / ((k * (k - 1)) / 2);
}

/** Power iteration; complete-case correlation matrices are PSD, so this converges to λmax. */
function largestEigenvalue(m: readonly number[][]): number {
  const k = m.length;
  let v = new Float64Array(k).fill(1 / Math.sqrt(k));
  let w = new Float64Array(k);
  let lambda = 0;
  for (let it = 0; it < POWER_ITERATIONS; it++) {
    let norm = 0;
    for (let a = 0; a < k; a++) {
      const row = m[a]!;
      let sum = 0;
      for (let b = 0; b < k; b++) sum += row[b]! * v[b]!;
      w[a] = sum;
      norm += sum * sum;
    }
    norm = Math.sqrt(norm);
    if (norm === 0) return 0;
    for (let a = 0; a < k; a++) w[a]! /= norm;
    [v, w] = [w, v];
    lambda = norm;
  }
  return lambda;
}
