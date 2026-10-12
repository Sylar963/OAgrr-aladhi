import { realizedVol, rollingRealizedVol } from '@oggregator/core';
import type {
  TradfiVolHistoryResponse,
  TradfiVolPoint,
  TradfiVolRank,
  VolConeBand,
} from '@oggregator/protocol';
import type { RawCandle } from '../tastytrade/candle-codec.js';
import type { CandleSource } from './candles.js';

export const TRADING_DAYS_PER_YEAR = 252;
export const RV_WINDOW_DAYS = 21;
const RANK_LOOKBACK_DAYS = { '6m': 126, '1y': 252 } as const;
// Same calendar horizons as the crypto cone, measured over the matching number of trading days.
const CONE_HORIZONS: ReadonlyArray<readonly [calendarDays: number, tradingDays: number]> = [
  [7, 5],
  [14, 10],
  [30, 21],
  [60, 42],
  [90, 63],
];
const MIN_CONE_WINDOWS = 20;
const DAY_MS = 86_400_000;

/** The published 30-day vol index that stands in for an underlying's IV, as VIX does for SPX. */
export const IV_INDEX: Readonly<Record<string, string>> = {
  SPX: 'VIX',
  XSP: 'VIX',
  SPY: 'VIX',
  RUT: 'RVX',
  IWM: 'RVX',
};

function positive(n: number): number | null {
  return Number.isFinite(n) && n > 0 ? n : null;
}

function quantile(sorted: readonly number[], q: number): number {
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (position - lower);
}

export function volRank(
  series: readonly TradfiVolPoint[],
  lookbackDays: number,
  field: 'iv' | 'rv',
): TradfiVolRank {
  const values = series
    .slice(-lookbackDays)
    .map((p) => p[field])
    .filter((v): v is number => v != null);
  const current = values.at(-1);
  if (current == null) {
    return { lookbackDays, rank: null, percentile: null, min: null, max: null, sampleCount: 0 };
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const ranked = values.length >= 2 && max > min;
  return {
    lookbackDays,
    rank: ranked ? ((current - min) / (max - min)) * 100 : null,
    percentile: ranked ? (values.filter((v) => v <= current).length / values.length) * 100 : null,
    min,
    max,
    sampleCount: values.length,
  };
}

export function volCone(closes: readonly number[]): VolConeBand[] {
  const bands: VolConeBand[] = [];
  for (const [horizonDays, windowDays] of CONE_HORIZONS) {
    const values: number[] = [];
    for (let end = windowDays + 1; end <= closes.length; end += 1) {
      const vol = realizedVol(closes.slice(end - windowDays - 1, end), TRADING_DAYS_PER_YEAR);
      if (vol != null) values.push(vol);
    }
    if (values.length < MIN_CONE_WINDOWS) continue;
    const sorted = values.sort((a, b) => a - b);
    bands.push({
      horizonDays,
      windowDays,
      sampleCount: sorted.length,
      min: sorted[0]!,
      p10: quantile(sorted, 0.1),
      p25: quantile(sorted, 0.25),
      p50: quantile(sorted, 0.5),
      p75: quantile(sorted, 0.75),
      p90: quantile(sorted, 0.9),
      max: sorted[sorted.length - 1]!,
      current: realizedVol(closes.slice(-(windowDays + 1)), TRADING_DAYS_PER_YEAR),
    });
  }
  return bands;
}

/** Daily history from DXLink candles; `index` bars (VIX-style, in vol points) replace the candle IV when present. */
export function buildVolHistory(
  underlying: string,
  bars: readonly RawCandle[],
  index?: { symbol: string; bars: readonly RawCandle[] },
): TradfiVolHistoryResponse | null {
  const days = bars
    .filter((b) => Number.isFinite(b.time) && positive(b.c) != null)
    .sort((a, b) => a.time - b.time);
  if (days.length === 0) return null;

  const indexIv = new Map<number, number>();
  for (const b of index?.bars ?? []) {
    const close = positive(b.c);
    if (close != null && Number.isFinite(b.time)) indexIv.set(Math.floor(b.time / DAY_MS), close / 100);
  }
  const useIndex = index != null && indexIv.size > 0;

  const rvByTs = new Map(
    rollingRealizedVol(
      days.map((b) => ({ timestamp: b.time, close: b.c })),
      RV_WINDOW_DAYS,
      TRADING_DAYS_PER_YEAR,
    ).map((p) => [p.timestamp, p.value]),
  );
  const series: TradfiVolPoint[] = days.map((b) => ({
    ts: b.time,
    close: b.c,
    iv: useIndex ? (indexIv.get(Math.floor(b.time / DAY_MS)) ?? null) : positive(b.iv),
    rv: rvByTs.get(b.time) ?? null,
  }));

  return {
    underlying,
    ivSource: useIndex ? index.symbol : 'IVx',
    rvWindowDays: RV_WINDOW_DAYS,
    periodsPerYear: TRADING_DAYS_PER_YEAR,
    series,
    ivRank: {
      '6m': volRank(series, RANK_LOOKBACK_DAYS['6m'], 'iv'),
      '1y': volRank(series, RANK_LOOKBACK_DAYS['1y'], 'iv'),
    },
    rvRank: {
      '6m': volRank(series, RANK_LOOKBACK_DAYS['6m'], 'rv'),
      '1y': volRank(series, RANK_LOOKBACK_DAYS['1y'], 'rv'),
    },
    volCone: volCone(days.map((b) => b.c)),
  };
}

const CACHE_TTL_MS = 5 * 60_000;
// DXLink keeps ~3 years of daily candles, and its oldest retained week is not split-adjusted
// (NVDA 4.61 instead of ~46), so stop two weeks short of it.
const HISTORY_MS = 1_080 * DAY_MS;

/** Daily vol history per underlying, cached for five minutes and shared by every route. */
export class VolHistorySource {
  private readonly cache = new Map<
    string,
    { at: number; response: Promise<TradfiVolHistoryResponse | null> }
  >();

  constructor(private readonly client: CandleSource & { isReady(): boolean }) {}

  isReady(): boolean {
    return this.client.isReady();
  }

  /** Callers pass only listed underlyings, so arbitrary symbols never reach the cache. */
  async get(underlying: string, now = Date.now()): Promise<TradfiVolHistoryResponse | null> {
    let hit = this.cache.get(underlying);
    if (hit == null || now - hit.at >= CACHE_TTL_MS) {
      hit = { at: now, response: this.load(underlying, now) };
      this.cache.set(underlying, hit);
    }
    const body = await hit.response.catch(() => null);
    if (body == null) this.cache.delete(underlying);
    return body;
  }

  private async load(underlying: string, now: number): Promise<TradfiVolHistoryResponse | null> {
    const from = now - HISTORY_MS;
    const indexSymbol = IV_INDEX[underlying];
    const [bars, indexBars] = await Promise.all([
      this.client.getCandles(underlying, 'd', from),
      indexSymbol != null ? this.client.getCandles(indexSymbol, 'd', from) : Promise.resolve([]),
    ]);
    return buildVolHistory(
      underlying,
      bars,
      indexSymbol != null ? { symbol: indexSymbol, bars: indexBars } : undefined,
    );
  }
}
