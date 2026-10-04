import {
  interpTenor,
  type IvHistoryExtrema,
  type IvHistoryPoint,
  type IvHistoryResponse,
  type IvHistoryTenorResult,
  type IvSurfaceRow,
  type IvTenor,
} from '../core/enrichment.js';
import { feedLogger } from '../utils/logger.js';
import type { DvolService } from './dvol.js';

const log = feedLogger('iv-history');

type IvTenorDays = 7 | 30 | 60 | 90;

const TENORS: IvTenor[] = ['7d', '30d', '60d', '90d'];
const TENOR_DAYS: Record<IvTenor, IvTenorDays> = { '7d': 7, '30d': 30, '60d': 60, '90d': 90 };
const TENOR_BY_DAYS: Record<number, IvTenor | undefined> = {
  7: '7d',
  30: '30d',
  60: '60d',
  90: '90d',
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const HISTORY_LOAD_DAYS = 90;

function emptyExtrema(): IvHistoryExtrema {
  return { atmIv: null, rr25d: null, bfly25d: null };
}

const SKEW_KEYS = ['rr25d', 'bfly25d', 'rr10d', 'bfly10d'] as const;
const DESPIKE_HALF_WINDOW = 6;
const DESPIKE_FLOOR = 0.01;
const DESPIKE_MAD_MULT = 5;

function median(sorted: number[]): number {
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function robustStats(values: number[]): { med: number; threshold: number } {
  const sorted = [...values].sort((a, b) => a - b);
  const med = median(sorted);
  const mad = median(sorted.map((v) => Math.abs(v - med)).sort((a, b) => a - b));
  return { med, threshold: Math.max(DESPIKE_FLOOR, DESPIKE_MAD_MULT * 1.4826 * mad) };
}

/**
 * Nulls skew fields that are single-snapshot outliers vs. their neighbours (Hampel filter).
 * The live grid occasionally yields a one-off RR/fly jump of several vol points that reverts
 * on the next sample (they cluster on the first snapshot after the top of the hour); left in,
 * they inflate σ and percentile extremes. Step changes survive because the centred median
 * follows the new level. Near the trailing edge there are too few forward neighbours for a
 * centred window, so an outlier vs. the preceding hour is held back until the next sample
 * confirms it: a genuine move surfaces one sample late, a glitch never does.
 */
export function despikeSkewSeries(series: IvHistoryPoint[]): IvHistoryPoint[] {
  const out = series.map((p) => ({ ...p }));
  const K = DESPIKE_HALF_WINDOW;
  for (const key of SKEW_KEYS) {
    const idx: number[] = [];
    for (let i = 0; i < series.length; i++) {
      const v = series[i]![key];
      if (v != null && Number.isFinite(v)) idx.push(i);
    }
    const valueAt = (j: number) => series[idx[j]!]![key]!;
    for (let j = K; j < idx.length; j++) {
      const value = valueAt(j);
      if (j + K < idx.length) {
        const window: number[] = [];
        for (let k = j - K; k <= j + K; k++) window.push(valueAt(k));
        const { med, threshold } = robustStats(window);
        if (Math.abs(value - med) > threshold) out[idx[j]!]![key] = null;
        continue;
      }
      const back: number[] = [];
      for (let k = j - 2 * K; k < j; k++) if (k >= 0) back.push(valueAt(k));
      const { med, threshold } = robustStats(back);
      const dev = value - med;
      if (Math.abs(dev) <= threshold) continue;
      const nextDev = j + 1 < idx.length ? valueAt(j + 1) - med : null;
      const confirmed = nextDev != null && Math.sign(nextDev) === Math.sign(dev) && Math.abs(nextDev) > threshold;
      if (!confirmed) out[idx[j]!]![key] = null;
    }
  }
  return out;
}

/**
 * IvSurfaceRow.dte is whole days rounded up (display convention). Variance-time interpolation
 * needs real time to expiry, otherwise a weekly 3.1 days out is weighted as 4 and every tenor
 * saw-tooths at the 08:00 UTC roll.
 */
export function withFractionalDte(surfaces: IvSurfaceRow[], now: number): IvSurfaceRow[] {
  return surfaces.map((row) => {
    const expiryMs = Date.parse(`${row.expiry}T08:00:00Z`);
    return Number.isFinite(expiryMs) ? { ...row, dte: (expiryMs - now) / MS_PER_DAY } : row;
  });
}

const CURRENT_FALLBACK_SAMPLES = 3;

/** Latest point with skew fields held at their last clean value when the newest sample was rejected. */
function latestClean(series: IvHistoryPoint[]): IvHistoryPoint | null {
  const last = series[series.length - 1];
  if (!last) return null;
  const latest = { ...last };
  for (const key of SKEW_KEYS) {
    if (latest[key] != null) continue;
    for (let i = series.length - 2; i >= Math.max(0, series.length - CURRENT_FALLBACK_SAMPLES); i--) {
      const v = series[i]![key];
      if (v != null) {
        latest[key] = v;
        break;
      }
    }
  }
  return latest;
}

export function downsampleSeries(series: IvHistoryPoint[], bucketMs: number): IvHistoryPoint[] {
  if (!(bucketMs > 0) || series.length === 0) return series;
  const out: IvHistoryPoint[] = [];
  let currentBucket = Number.NaN;
  for (const point of series) {
    const bucket = Math.floor(point.ts / bucketMs);
    if (bucket === currentBucket) out[out.length - 1] = point;
    else out.push(point);
    currentBucket = bucket;
  }
  return out;
}

export interface IvHistoryQueryOptions {
  /** Keep the last sample per bucket of this size. Stats are always computed at full resolution. */
  resolutionMs?: number;
  /** Only this tenor carries a series; the others return current + stats with an empty series. */
  seriesTenor?: IvTenor;
}

function bufferKey(underlying: string, tenor: IvTenor): string {
  return `${underlying}:${tenor}`;
}

interface RankPct {
  rank: number | null;
  percentile: number | null;
}

function rankAndPercentile(
  values: Array<number | null>,
  current: number | null,
): RankPct {
  if (current == null || !Number.isFinite(current)) return { rank: null, percentile: null };
  const xs = values.filter((v): v is number => v != null && Number.isFinite(v));
  // Need at least two samples AND a non-zero range for rank/percentile to be
  // meaningful. With one sample or a flat window the formulas trivially
  // produce 0/100, which misleads more than it informs — prefer null so the
  // UI renders "–" (insufficient data) instead.
  if (xs.length < 2) return { rank: null, percentile: null };
  let min = Infinity;
  let max = -Infinity;
  let leq = 0;
  for (const x of xs) {
    if (x < min) min = x;
    if (x > max) max = x;
    if (x <= current) leq += 1;
  }
  if (max <= min) return { rank: null, percentile: null };
  const rank = ((current - min) / (max - min)) * 100;
  const percentile = (leq / xs.length) * 100;
  return { rank, percentile };
}

export interface IvHistoryDeps {
  /** Builds a fresh IvSurfaceRow[] for the underlying across all listed expiries. */
  getSurfaceGrid: (underlying: string) => Promise<IvSurfaceRow[]>;
  /** Source of the DVOL 30d seed. Only BTC/ETH are seeded. */
  dvol: DvolService;
  /** Optional persistence layer. Core stays storage-agnostic; server wires DB in. */
  store?: IvHistoryPersistence;
}

export interface IvHistoryOptions {
  underlyings?: string[];
  intervalMs?: number;
  capacity?: number;
}

export type IvHistoryPointSource = 'live_surface' | 'deribit_dvol';

export interface PersistedIvHistoryPoint {
  underlying: string;
  tenorDays: IvTenorDays;
  ts: Date;
  atmIv: number | null;
  rr25d: number | null;
  bfly25d: number | null;
  rr10d: number | null;
  bfly10d: number | null;
  source: IvHistoryPointSource;
}

export interface IvHistoryPersistence {
  readonly enabled: boolean;
  writeMany(points: PersistedIvHistoryPoint[]): Promise<void>;
  loadSince(query: { underlyings: string[]; since: Date }): Promise<PersistedIvHistoryPoint[]>;
}

/**
 * Tracks constant-maturity ATM IV, 25Δ risk-reversal, and 25Δ butterfly across
 * 7/30/60/90-day tenors. Snapshots every `intervalMs` from the live surface
 * grid; 30d ATM IV seeds from DvolService candles so IV rank is usable at
 * startup for BTC/ETH.
 *
 * In-memory ring buffer, matches the DvolService pattern: state is lost on
 * restart. Callers re-populate organically from the snapshot loop (and the
 * DVOL seed) without operator intervention.
 */
export class IvHistoryService {
  private buffers = new Map<string, IvHistoryPoint[]>();
  private cleaned = new Map<
    string,
    { length: number; firstTs: number; lastTs: number; series: IvHistoryPoint[] }
  >();
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly underlyings: string[];
  private readonly intervalMs: number;
  private readonly capacity: number;

  constructor(
    private deps: IvHistoryDeps,
    opts: IvHistoryOptions = {},
  ) {
    this.underlyings = opts.underlyings ?? ['BTC', 'ETH'];
    this.intervalMs = opts.intervalMs ?? 5 * 60 * 1000;
    // 90 days at default 5-minute cadence.
    this.capacity = opts.capacity ?? 90 * 24 * 12;
  }

  async start(): Promise<void> {
    await this.loadPersistedHistory();
    await this.seedFromDvol();
    // No snapshot at boot: venue feeds are still reconnecting and replaying subscriptions, so
    // the grid is partial and skew comes out several vol points off (the hourly restart timer
    // made this the single largest source of RR/fly glitches). Persisted history covers the gap.
    this.timer = setInterval(() => {
      this.snapshotOnce().catch((err: unknown) => {
        log.warn({ err: String(err) }, 'IV-history snapshot failed');
      });
    }, this.intervalMs);
    log.info(
      { underlyings: this.underlyings, intervalMs: this.intervalMs, capacity: this.capacity },
      'IvHistoryService started',
    );
  }

  dispose(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  query(
    underlying: string,
    windowDays: 30 | 90,
    opts: IvHistoryQueryOptions = {},
  ): IvHistoryResponse {
    const cutoff = Date.now() - windowDays * MS_PER_DAY;
    const tenors = {} as Record<IvTenor, IvHistoryTenorResult>;
    for (const tenor of TENORS) {
      const result = this.buildTenorResult(underlying, tenor, cutoff);
      if (opts.seriesTenor != null && opts.seriesTenor !== tenor) {
        result.series = [];
      } else if (opts.resolutionMs != null) {
        result.series = downsampleSeries(result.series, opts.resolutionMs);
      }
      tenors[tenor] = result;
    }
    return { underlying, windowDays, tenors };
  }

  /** Exposed for tests. */
  getBuffer(underlying: string, tenor: IvTenor): IvHistoryPoint[] {
    return this.buffers.get(bufferKey(underlying, tenor)) ?? [];
  }

  /** Exposed for tests. */
  async snapshotOnce(now: number = Date.now()): Promise<void> {
    const persisted: PersistedIvHistoryPoint[] = [];
    for (const underlying of this.underlyings) {
      let surfaces: IvSurfaceRow[];
      try {
        surfaces = await this.deps.getSurfaceGrid(underlying);
      } catch (err: unknown) {
        log.warn({ underlying, err: String(err) }, 'surface grid fetch failed');
        continue;
      }
      if (surfaces.length === 0) continue;
      surfaces = withFractionalDte(surfaces, now);
      // For 30d BTC/ETH we align the live "current" with the DVOL-seeded
      // history. DVOL uses Deribit's own variance methodology across multiple
      // strikes; our interpTenor uses cross-venue ATM averages. Mixing them
      // introduces a systematic 1–3 vol-point gap that pins rank at 0.
      const dvolAtm =
        underlying === 'BTC' || underlying === 'ETH'
          ? (this.deps.dvol.getSnapshot?.(underlying)?.current ?? null)
          : null;
      for (const tenor of TENORS) {
        const days = TENOR_DAYS[tenor];
        const interpAtm = interpTenor(surfaces, days, 'atm');
        const atm = tenor === '30d' && dvolAtm != null ? dvolAtm : interpAtm;
        const c25 = interpTenor(surfaces, days, 'delta25c');
        const p25 = interpTenor(surfaces, days, 'delta25p');
        const rr = c25 != null && p25 != null ? c25 - p25 : null;
        // Butterfly uses the SAME ATM reference as the wings: interpolated, not
        // DVOL, so fly = (c25+p25)/2 − interpAtm stays internally consistent.
        const fly =
          c25 != null && p25 != null && interpAtm != null
            ? (c25 + p25) / 2 - interpAtm
            : null;
        const c10 = interpTenor(surfaces, days, 'delta10c');
        const p10 = interpTenor(surfaces, days, 'delta10p');
        const rr10 = c10 != null && p10 != null ? c10 - p10 : null;
        const fly10 =
          c10 != null && p10 != null && interpAtm != null
            ? (c10 + p10) / 2 - interpAtm
            : null;
        this.appendPoint(underlying, tenor, {
          ts: now,
          atmIv: atm,
          rr25d: rr,
          bfly25d: fly,
          rr10d: rr10,
          bfly10d: fly10,
        });
        persisted.push({
          underlying,
          tenorDays: days,
          ts: new Date(now),
          atmIv: atm,
          rr25d: rr,
          bfly25d: fly,
          rr10d: rr10,
          bfly10d: fly10,
          source: 'live_surface',
        });
      }
    }
    await this.persistPoints(persisted);
  }

  // ── internals ────────────────────────────────────────────────────

  private getCleanBuffer(underlying: string, tenor: IvTenor): IvHistoryPoint[] {
    const key = bufferKey(underlying, tenor);
    const buf = this.buffers.get(key) ?? [];
    const firstTs = buf[0]?.ts ?? 0;
    const lastTs = buf[buf.length - 1]?.ts ?? 0;
    const hit = this.cleaned.get(key);
    if (hit && hit.length === buf.length && hit.firstTs === firstTs && hit.lastTs === lastTs) {
      return hit.series;
    }
    const series = despikeSkewSeries(buf);
    this.cleaned.set(key, { length: buf.length, firstTs, lastTs, series });
    return series;
  }

  private appendPoint(underlying: string, tenor: IvTenor, point: IvHistoryPoint): void {
    const key = bufferKey(underlying, tenor);
    const buf = this.buffers.get(key) ?? [];
    buf.push(point);
    if (buf.length > this.capacity) {
      buf.splice(0, buf.length - this.capacity);
    }
    this.buffers.set(key, buf);
  }

  private async loadPersistedHistory(): Promise<void> {
    const store = this.deps.store;
    if (!store?.enabled) return;

    const since = new Date(Date.now() - HISTORY_LOAD_DAYS * MS_PER_DAY);
    let points: PersistedIvHistoryPoint[];
    try {
      points = await store.loadSince({ underlyings: this.underlyings, since });
    } catch (err: unknown) {
      log.warn({ err: String(err) }, 'failed to load persisted IV history');
      return;
    }

    for (const point of points) {
      const tenor = TENOR_BY_DAYS[point.tenorDays];
      if (!tenor) continue;
      this.appendPoint(point.underlying, tenor, {
        ts: point.ts.getTime(),
        atmIv: point.atmIv,
        rr25d: point.rr25d,
        bfly25d: point.bfly25d,
        rr10d: point.rr10d,
        bfly10d: point.bfly10d,
      });
    }

    log.info({ count: points.length, since: since.toISOString() }, 'loaded persisted IV history');
  }

  private async seedFromDvol(): Promise<void> {
    const persisted: PersistedIvHistoryPoint[] = [];
    for (const underlying of this.underlyings) {
      if (underlying !== 'BTC' && underlying !== 'ETH') continue;
      if (this.getBuffer(underlying, '30d').length > 0) continue;
      const candles = this.deps.dvol.getHistory(underlying);
      if (candles.length === 0) {
        log.warn(
          { underlying },
          'DVOL history empty at seed time — 30d IV rank will require accumulation',
        );
        continue;
      }
      // DVOL candles are percentage (52.1 = 52.1%); internal convention is fraction.
      // DVOL is 30d ATM-only — skew & wing come from snapshot loop.
      const seed: IvHistoryPoint[] = candles.map((c) => ({
        ts: c.timestamp,
        atmIv: c.close / 100,
        rr25d: null,
        bfly25d: null,
        rr10d: null,
        bfly10d: null,
      }));
      this.buffers.set(bufferKey(underlying, '30d'), seed.slice(-this.capacity));
      persisted.push(
        ...seed.slice(-this.capacity).map((point) => ({
          underlying,
          tenorDays: 30 as const,
          ts: new Date(point.ts),
          atmIv: point.atmIv,
          rr25d: null,
          bfly25d: null,
          rr10d: null,
          bfly10d: null,
          source: 'deribit_dvol' as const,
        })),
      );
      const first = seed[0]!;
      const last = seed[seed.length - 1]!;
      log.info(
        {
          underlying,
          count: seed.length,
          firstTs: new Date(first.ts).toISOString(),
          lastTs: new Date(last.ts).toISOString(),
          firstIv: first.atmIv,
          lastIv: last.atmIv,
        },
        'seeded 30d ATM from DVOL',
      );
    }
    await this.persistPoints(persisted);
  }

  private async persistPoints(points: PersistedIvHistoryPoint[]): Promise<void> {
    const store = this.deps.store;
    if (!store?.enabled || points.length === 0) return;
    try {
      await store.writeMany(points);
    } catch (err: unknown) {
      log.warn({ err: String(err), count: points.length }, 'failed to persist IV history');
    }
  }

  private buildTenorResult(
    underlying: string,
    tenor: IvTenor,
    cutoff: number,
  ): IvHistoryTenorResult {
    const series = this.getCleanBuffer(underlying, tenor).filter((p) => p.ts >= cutoff);
    const latest = latestClean(series) ?? {
      ts: 0,
      atmIv: null,
      rr25d: null,
      bfly25d: null,
      rr10d: null,
      bfly10d: null,
    };

    const atmValues = series.map((p) => p.atmIv);
    const rrValues = series.map((p) => p.rr25d);
    const flyValues = series.map((p) => p.bfly25d);

    const atmStats = rankAndPercentile(atmValues, latest.atmIv);
    const rrStats = rankAndPercentile(rrValues, latest.rr25d);
    const flyStats = rankAndPercentile(flyValues, latest.bfly25d);

    const min = emptyExtrema();
    const max = emptyExtrema();
    let atmMin = Infinity;
    let atmMax = -Infinity;
    let rrMin = Infinity;
    let rrMax = -Infinity;
    let flyMin = Infinity;
    let flyMax = -Infinity;
    for (const p of series) {
      if (p.atmIv != null) {
        if (p.atmIv < atmMin) atmMin = p.atmIv;
        if (p.atmIv > atmMax) atmMax = p.atmIv;
      }
      if (p.rr25d != null) {
        if (p.rr25d < rrMin) rrMin = p.rr25d;
        if (p.rr25d > rrMax) rrMax = p.rr25d;
      }
      if (p.bfly25d != null) {
        if (p.bfly25d < flyMin) flyMin = p.bfly25d;
        if (p.bfly25d > flyMax) flyMax = p.bfly25d;
      }
    }
    if (atmMin !== Infinity) {
      min.atmIv = atmMin;
      max.atmIv = atmMax;
    }
    if (rrMin !== Infinity) {
      min.rr25d = rrMin;
      max.rr25d = rrMax;
    }
    if (flyMin !== Infinity) {
      min.bfly25d = flyMin;
      max.bfly25d = flyMax;
    }

    return {
      current: latest,
      atmRank: atmStats.rank,
      atmPercentile: atmStats.percentile,
      rrRank: rrStats.rank,
      rrPercentile: rrStats.percentile,
      flyRank: flyStats.rank,
      flyPercentile: flyStats.percentile,
      min,
      max,
      series,
    };
  }
}
