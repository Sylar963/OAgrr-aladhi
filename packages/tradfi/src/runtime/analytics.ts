import {
  aggregateOptionsActivity,
  computeOptionsParity,
  PARITY_MAX_QUOTE_AGE_MS,
  PARITY_MAX_QUOTE_SKEW_MS,
} from '@oggregator/core';
import type { TradfiAnalyticsResponse, TradfiParityResponse } from '@oggregator/protocol';
import { TRADFI_ANALYTICS_HEATMAP_STRIKES } from '@oggregator/protocol';
import type { TradfiDeps } from '../app.js';

export function liveExpiries(deps: TradfiDeps, underlying: string, now: number): string[] {
  return deps.store
    .listExpiries(underlying)
    .filter((expiry) =>
      deps.store.instrumentsFor(underlying, expiry).some((i) => i.expiryTs > now),
    );
}

export function buildAnalytics(
  deps: TradfiDeps,
  underlying: string,
  expiries: string[],
  now: number,
): TradfiAnalyticsResponse {
  const dayId = deps.store.getTradingDay(underlying);
  const deferredExpiries = expiries.filter(
    (e) => deps.feed.hasChainTier?.(underlying, e, 'analytics') === false,
  );
  const deferred = new Set(deferredExpiries);
  let lastVolumeAt: number | null = null;
  let lastOiAt: number | null = null;
  const inputs = expiries.flatMap((expiry) =>
    deps.store.instrumentsFor(underlying, expiry).map((inst) => {
      const q = deferred.has(expiry) ? undefined : deps.store.getQuote(inst.streamerSymbol);
      const sameSession = dayId != null && q?.volumeDayId === dayId;
      if (sameSession && q?.volumeTs != null)
        lastVolumeAt = Math.max(lastVolumeAt ?? 0, q.volumeTs);
      if (q?.oiTs != null) lastOiAt = Math.max(lastOiAt ?? 0, q.oiTs);
      return {
        symbol: inst.streamerSymbol,
        expiry,
        strike: inst.strike,
        right: inst.right,
        multiplier: inst.multiplier,
        volume: sameSession ? (q?.volume ?? null) : null,
        openInterest: q?.openInterest ?? null,
      };
    }),
  );
  const aggregate = aggregateOptionsActivity(inputs, deps.store.getSpot(underlying));
  const heatmapStrikes = new Set(
    (['volume', 'openInterest', 'volumeNotionalUsd', 'oiNotionalUsd'] as const).flatMap((field) =>
      [...aggregate.byStrike]
        .sort((a, b) => {
          const total = (row: typeof a) =>
            row.call[field] == null && row.put[field] == null
              ? -1
              : (row.call[field] ?? 0) + (row.put[field] ?? 0);
          return total(b) - total(a);
        })
        .slice(0, TRADFI_ANALYTICS_HEATMAP_STRIKES)
        .map((r) => r.strike),
    ),
  );
  return {
    underlying,
    asOf: now,
    sessionDate: dayId == null ? null : new Date(dayId * 86_400_000).toISOString().slice(0, 10),
    lastVolumeAt,
    lastOiAt,
    spot: deps.store.getSpot(underlying),
    streaming: deps.feed.readiness().streaming,
    expiries,
    deferredExpiries,
    ...aggregate,
    cells: aggregate.cells.filter((cell) => heatmapStrikes.has(cell.strike)),
    byExpiry: aggregate.byExpiry.map((row) => ({
      ...row,
      dte: Math.max(
        0,
        ((deps.store.instrumentsFor(underlying, row.expiry)[0]?.expiryTs ?? now) - now) /
          86_400_000,
      ),
    })),
  };
}

export function buildParity(
  deps: TradfiDeps,
  underlying: string,
  expiry: string,
  now: number,
): TradfiParityResponse {
  const deferred = deps.feed.hasChainTier?.(underlying, expiry, 'parity') === false;
  const insts = deps.store.instrumentsFor(underlying, expiry);
  const europeanConsistency = underlying === 'SPX' && insts.every((i) => i.rootSymbol === 'SPXW');
  const inputs = insts.map((inst) => {
    const q = deferred ? undefined : deps.store.getQuote(inst.streamerSymbol);
    return {
      root: inst.rootSymbol,
      expiryTs: inst.expiryTs,
      settlement: inst.settlementType,
      strike: inst.strike,
      multiplier: inst.multiplier,
      right: inst.right,
      quote:
        q == null
          ? null
          : {
              bid: q.bid,
              ask: q.ask,
              bidSize: q.bidSize,
              askSize: q.askSize,
              bidTime: q.bidTime,
              askTime: q.askTime,
              receivedAt: q.quoteReceivedAt,
            },
    };
  });
  return {
    underlying,
    expiry,
    asOf: now,
    streaming: deps.feed.readiness().streaming,
    deferred,
    europeanConsistency,
    maxQuoteAgeMs: PARITY_MAX_QUOTE_AGE_MS,
    maxQuoteSkewMs: PARITY_MAX_QUOTE_SKEW_MS,
    rows: computeOptionsParity(inputs, now, europeanConsistency),
  };
}
