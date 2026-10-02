import {
  realizedVol,
  type IvHistoryResponse,
  type RegimeQueryResult,
  type SpotCandle,
  type VolRichness,
} from '@oggregator/core';
import type { AlphaMarketContextResponse } from '@oggregator/protocol';

const DAYS_IN_YEAR = 365;

interface AlphaMarketContextInput {
  underlying: string;
  nowMs: number;
  spotPrice: number | null;
  ivHistory: IvHistoryResponse | null;
  candles: SpotCandle[];
  regime: RegimeQueryResult | null;
  richness?: VolRichness | null;
}

type VolatilityState = AlphaMarketContextResponse['volatility']['state'];

const STATE_BY_RICHNESS: Record<'cheap' | 'fair' | 'rich', VolatilityState> = {
  cheap: 'compressed',
  fair: 'normal',
  rich: 'bid',
};

function volatilityStateOf(
  richness: VolRichness | null,
  ivPercentile30d: number | null,
): Pick<AlphaMarketContextResponse['volatility'], 'state' | 'stateSource'> {
  const richness30d = richness?.tenors['30d'].state ?? 'unavailable';
  if (richness30d !== 'unavailable') {
    return { state: STATE_BY_RICHNESS[richness30d], stateSource: 'excess-premium' };
  }
  if (ivPercentile30d == null) return { state: 'unavailable', stateSource: 'unavailable' };
  return {
    state: ivPercentile30d <= 30 ? 'compressed' : ivPercentile30d >= 70 ? 'bid' : 'normal',
    stateSource: 'iv-percentile',
  };
}

function ivChange(series: IvHistoryResponse['tenors']['30d']['series'], days: number): number | null {
  const current = series.at(-1);
  if (current?.atmIv == null) return null;
  const cutoff = current.ts - days * 86_400_000;
  for (let index = series.length - 1; index >= 0; index -= 1) {
    const point = series[index];
    if (point != null && point.ts <= cutoff && point.atmIv != null) {
      return current.atmIv - point.atmIv;
    }
  }
  return null;
}

function rangeWidthPct(candles: readonly SpotCandle[], days: number): number | null {
  if (candles.length < days) return null;
  const window = candles.slice(-days);
  const reference = window.at(-1)?.close;
  if (reference == null || reference <= 0) return null;
  const high = Math.max(...window.map((candle) => candle.high));
  const low = Math.min(...window.map((candle) => candle.low));
  return ((high - low) / reference) * 100;
}

function rangePercentile(candles: readonly SpotCandle[], days: number): number | null {
  if (candles.length < days * 2) return null;
  const widths: number[] = [];
  for (let end = days; end <= candles.length; end += 1) {
    const width = rangeWidthPct(candles.slice(0, end), days);
    if (width != null) widths.push(width);
  }
  const current = widths.at(-1);
  if (current == null || widths.length < 2) return null;
  return (widths.filter((width) => width <= current).length / widths.length) * 100;
}

function spotRangeState(
  candles: readonly SpotCandle[],
  spotPrice: number | null,
  expectedMovePct: number | null,
): AlphaMarketContextResponse['spotState'] {
  if (spotPrice == null || candles.length < 21) {
    return { state: 'unavailable', direction: null, extensionPct: null };
  }
  const prior = candles.slice(-21, -1);
  const high = Math.max(...prior.map((candle) => candle.high));
  const low = Math.min(...prior.map((candle) => candle.low));
  if (spotPrice >= low && spotPrice <= high) {
    return { state: 'inside-range', direction: null, extensionPct: 0 };
  }
  const direction = spotPrice > high ? 'up' : 'down';
  const boundary = direction === 'up' ? high : low;
  const extensionPct = (Math.abs(spotPrice - boundary) / boundary) * 100;
  return {
    state:
      expectedMovePct != null && extensionPct > expectedMovePct ? 'extended' : 'breaking-out',
    direction,
    extensionPct,
  };
}

export function buildAlphaMarketContext(input: AlphaMarketContextInput): AlphaMarketContextResponse {
  const history7d = input.ivHistory?.tenors['7d'] ?? null;
  const history30d = input.ivHistory?.tenors['30d'] ?? null;
  const atmIv7d = history7d?.current.atmIv ?? null;
  const atmIv30d = history30d?.current.atmIv ?? null;
  const ivPercentile7d = history7d?.atmPercentile ?? null;
  const ivPercentile30d = history30d?.atmPercentile ?? null;
  const closes = input.candles.map((candle) => candle.close);
  const rv7d = closes.length >= 8 ? realizedVol(closes.slice(-8), DAYS_IN_YEAR) : null;
  const rv30d = closes.length >= 31 ? realizedVol(closes.slice(-31), DAYS_IN_YEAR) : null;
  const vrp7d = atmIv7d != null && rv7d != null ? atmIv7d - rv7d : null;
  const vrp30d = atmIv30d != null && rv30d != null ? atmIv30d - rv30d : null;
  const expectedMoves = [
    { days: 7, iv: atmIv7d },
    { days: 30, iv: atmIv30d },
  ].map(({ days, iv }) => {
    const movePct = iv == null ? null : iv * Math.sqrt(days / DAYS_IN_YEAR) * 100;
    return {
      days,
      iv,
      moveUsd: movePct == null || input.spotPrice == null ? null : input.spotPrice * movePct / 100,
      movePct,
    };
  });
  const percentile14d = rangePercentile(input.candles, 14);
  const rangeState =
    percentile14d == null
      ? 'unavailable'
      : percentile14d <= 30
        ? 'coiled'
        : percentile14d >= 70
          ? 'expanded'
          : 'normal';
  const richness = input.richness ?? null;
  const { state: volatilityState, stateSource } = volatilityStateOf(richness, ivPercentile30d);
  const spotState = spotRangeState(input.candles, input.spotPrice, expectedMoves[0]!.movePct);
  const longCall =
    volatilityState === 'unavailable' || rangeState === 'unavailable'
      ? 'unavailable'
        : volatilityState === 'bid' || spotState.state === 'extended'
          ? 'expensive'
          : volatilityState === 'compressed' &&
              spotState.direction !== 'down' &&
              (rangeState === 'coiled' || spotState.state === 'breaking-out')
            ? 'favorable'
            : 'watch';
  // Insurance is cheapest when vol is quiet or spot has run up; after a breakdown, puts carry the panic bid.
  const protectivePut =
    volatilityState === 'unavailable'
      ? 'unavailable'
      : volatilityState === 'bid' || spotState.direction === 'down'
        ? 'expensive'
        : volatilityState === 'compressed' ||
            (spotState.direction === 'up' && spotState.state === 'extended')
          ? 'favorable'
          : 'watch';
  const creditSpread =
    vrp30d == null
      ? 'unavailable'
      : vrp30d <= 0 || spotState.state === 'extended'
        ? 'unfavorable'
        : vrp30d >= 0.05 && volatilityState !== 'compressed'
          ? 'favorable'
          : 'watch';

  return {
    generatedAt: input.nowMs,
    underlying: input.underlying,
    spotPrice: input.spotPrice,
    volatility: {
      state: volatilityState,
      stateSource,
      atmIv7d,
      atmIv30d,
      ivPercentile7d,
      ivPercentile30d,
      ivChange1d: history30d == null ? null : ivChange(history30d.series, 1),
      ivChange7d: history30d == null ? null : ivChange(history30d.series, 7),
    },
    realized: { rv7d, rv30d, vrp7d, vrp30d },
    expectedMoves,
    range: {
      state: rangeState,
      width14dPct: rangeWidthPct(input.candles, 14),
      width30dPct: rangeWidthPct(input.candles, 30),
      percentile14d,
    },
    spotState,
    setup: { longCall, protectivePut, creditSpread },
    regime:
      input.regime == null
        ? null
        : {
            dominant: input.regime.dominant,
            direction: input.regime.direction,
            confidence: input.regime.confidence,
            observationCount: input.regime.observationCount,
          },
    richness,
    sources: {
      ivHistory: atmIv7d != null || atmIv30d != null,
      spotHistory: input.candles.length > 0,
      regime: input.regime != null,
      ivScope: input.underlying === 'BTC' || input.underlying === 'ETH' ? 'mixed' : 'cross-venue',
    },
  };
}
