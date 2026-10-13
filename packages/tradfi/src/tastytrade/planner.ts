import type { DxSub, DxEventType } from './codec.js';
import type { TradfiInstrument } from './instrument.js';
import type { TradfiLiveQuote } from '../runtime/store.js';

const CONTRACT_EVENTS: DxEventType[] = ['Quote', 'Greeks', 'Trade', 'Summary'];
const UNDERLYING_EVENTS: DxEventType[] = ['Quote', 'Trade', 'Summary'];

/**
 * `full` streams every contract with quotes, greeks, trades and OI (chain, GEX views).
 * `surface` streams greeks only on a sampled strike set — IV and delta are all a
 * surface or smile fit reads, at a fraction of the DXLink subscription budget.
 */
export type ChainTier = 'full' | 'surface';

const TIER_EVENTS: Record<ChainTier, readonly DxEventType[]> = {
  full: CONTRACT_EVENTS,
  surface: ['Greeks'],
};

/** Quote fields each event type writes, cleared when that stream is dropped. */
export const EVENT_QUOTE_FIELDS: Record<DxEventType, readonly (keyof Omit<TradfiLiveQuote, 'ts'>)[]> = {
  Quote: ['bid', 'ask', 'bidSize', 'askSize', 'mark'],
  Greeks: ['iv', 'delta', 'gamma', 'theta', 'vega', 'rho'],
  Trade: ['last', 'volume'],
  Summary: ['openInterest'],
};

export const SURFACE_MAX_STRIKES = 60;
// Wing strikes past these log-moneyness bounds carry no usable IV but would eat sample slots.
const MIN_LOG_MONEYNESS = -1.2;
const MAX_LOG_MONEYNESS = 0.8;
const YEAR_MS = 365 * 86_400_000;

export function chainSubscriptions(streamerSymbols: string[]): DxSub[] {
  const subs: DxSub[] = [];
  for (const symbol of streamerSymbols) {
    for (const type of CONTRACT_EVENTS) subs.push({ type, symbol });
  }
  return subs;
}

export function underlyingSubscriptions(underlyings: string[]): DxSub[] {
  const subs: DxSub[] = [];
  for (const symbol of underlyings) {
    for (const type of UNDERLYING_EVENTS) subs.push({ type, symbol });
  }
  return subs;
}

/**
 * Pick at most `max` strikes, dense near the money and sparse in the wings. Targets are
 * spaced evenly in asinh(log-moneyness / width): linear inside ±width, logarithmic beyond,
 * with width growing with √T so long expiries spread their samples wider.
 */
export function sampleSurfaceStrikes(
  strikes: readonly number[],
  spot: number | null,
  years: number,
  max = SURFACE_MAX_STRIKES,
): number[] {
  const sorted = [...new Set(strikes.filter((k) => k > 0))].sort((a, b) => a - b);
  if (sorted.length <= max) return sorted;
  const center = spot != null && spot > 0 ? spot : sorted[Math.floor(sorted.length / 2)]!;
  const width = Math.max(0.02, 0.25 * Math.sqrt(Math.max(years, 0)));
  const toU = (k: number) => Math.asinh(Math.log(k / center) / width);

  const inBand = sorted.filter((k) => {
    const m = Math.log(k / center);
    return m >= MIN_LOG_MONEYNESS && m <= MAX_LOG_MONEYNESS;
  });
  const pool = inBand.length > 0 ? inBand : sorted;
  if (pool.length <= max) return pool;

  const us = pool.map(toU);
  const lo = us[0]!;
  const hi = us[us.length - 1]!;
  const picked = new Set<number>();
  const pickNearest = (target: number) => {
    let a = 0;
    let b = us.length - 1;
    while (b - a > 1) {
      const mid = (a + b) >> 1;
      if (us[mid]! < target) a = mid;
      else b = mid;
    }
    picked.add(Math.abs(us[a]! - target) <= Math.abs(us[b]! - target) ? pool[a]! : pool[b]!);
  };
  pickNearest(0);
  for (let i = 0; i < max - 1; i++) pickNearest(lo + ((hi - lo) * i) / (max - 2));
  return [...picked].sort((a, b) => a - b);
}

/** The deduplicated subscription set for one chain under the union of `tiers`. */
export function planChainSubscriptions(
  insts: readonly TradfiInstrument[],
  tiers: Iterable<ChainTier>,
  spot: number | null,
  now: number,
): DxSub[] {
  const types = new Map<string, Set<DxEventType>>();
  const add = (symbol: string, events: readonly DxEventType[]) => {
    const set = types.get(symbol) ?? new Set<DxEventType>();
    for (const e of events) set.add(e);
    types.set(symbol, set);
  };

  for (const tier of tiers) {
    if (tier === 'full') {
      for (const inst of insts) add(inst.streamerSymbol, TIER_EVENTS.full);
      continue;
    }
    const expiryTs = insts[0]?.expiryTs ?? now;
    const sampled = new Set(
      sampleSurfaceStrikes(
        insts.map((i) => i.strike),
        spot,
        (expiryTs - now) / YEAR_MS,
      ),
    );
    for (const inst of insts) if (sampled.has(inst.strike)) add(inst.streamerSymbol, TIER_EVENTS.surface);
  }

  const subs: DxSub[] = [];
  for (const inst of insts) {
    const set = types.get(inst.streamerSymbol);
    if (set == null) continue;
    for (const type of CONTRACT_EVENTS) if (set.has(type)) subs.push({ type, symbol: inst.streamerSymbol });
  }
  return subs;
}
