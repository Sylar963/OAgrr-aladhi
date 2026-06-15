import { EMPTY_GREEKS } from '../../core/types.js';
import type { CachedInstrument, LiveQuote } from '../shared/sdk-base.js';
import type { DeribitBookSummary, DeribitMarkPriceItem, DeribitTicker } from './types.js';

export interface DeribitState {
  liveIndexPrices: Map<string, number>;
  indexToInstruments: Map<string, Set<string>>;
}

export interface DeribitSubscribedTickerStaleness {
  subscribedTickers: number;
  staleSubscribedTickers: number;
  missingQuotes: number;
  oldestStaleAgeMs: number | null;
  newestStaleAgeMs: number | null;
  staleExamples: string[];
}

export function createDeribitState(): DeribitState {
  return {
    liveIndexPrices: new Map(),
    indexToInstruments: new Map(),
  };
}

export function registerDeribitInstrument(
  state: DeribitState,
  instruments: CachedInstrument[],
  instrumentMap: Map<string, CachedInstrument>,
  symbolIndex: Map<string, string>,
  indexName: string,
  instrument: CachedInstrument,
): void {
  instruments.push(instrument);
  instrumentMap.set(instrument.exchangeSymbol, instrument);
  symbolIndex.set(instrument.symbol, instrument.exchangeSymbol);

  const indexInstruments = state.indexToInstruments.get(indexName) ?? new Set<string>();
  indexInstruments.add(instrument.exchangeSymbol);
  state.indexToInstruments.set(indexName, indexInstruments);
}

export function removeDeribitInstrument(
  state: DeribitState,
  instruments: CachedInstrument[],
  instrumentMap: Map<string, CachedInstrument>,
  symbolIndex: Map<string, string>,
  quoteStore: Map<string, LiveQuote>,
  indexName: string,
  exchangeSymbol: string,
): CachedInstrument | null {
  const instrument = instrumentMap.get(exchangeSymbol);
  if (instrument == null) return null;

  const nextInstruments = instruments.filter((item) => item.exchangeSymbol !== exchangeSymbol);
  instruments.length = 0;
  instruments.push(...nextInstruments);

  instrumentMap.delete(exchangeSymbol);
  symbolIndex.delete(instrument.symbol);
  quoteStore.delete(exchangeSymbol);
  state.indexToInstruments.get(indexName)?.delete(exchangeSymbol);

  return instrument;
}

export function applyDeribitBookSummary(
  quoteStore: Map<string, LiveQuote>,
  summary: DeribitBookSummary,
  now: number,
  contractSize: number | null,
  ivToFraction: (value: unknown) => number | null,
  safeNum: (value: unknown) => number | null,
): void {
  const rawOpenInterest = safeNum(summary.open_interest);
  const normalizedOpenInterest =
    rawOpenInterest != null && contractSize != null && contractSize > 0
      ? rawOpenInterest / contractSize
      : rawOpenInterest;

  quoteStore.set(summary.instrument_name, {
    bidPrice: safeNum(summary.bid_price),
    askPrice: safeNum(summary.ask_price),
    bidSize: null,
    askSize: null,
    markPrice: safeNum(summary.mark_price),
    lastPrice: safeNum(summary.last),
    underlyingPrice: safeNum(summary.underlying_price),
    indexPrice: null,
    volume24h: safeNum(summary.volume),
    openInterest: normalizedOpenInterest,
    openInterestUsd: null,
    volume24hUsd: safeNum(summary.volume_usd),
    greeks: {
      ...EMPTY_GREEKS,
      markIv: ivToFraction(summary.mark_iv),
    },
    timestamp: now,
  });
}

export function applyDeribitPriceIndex(
  state: DeribitState,
  quoteStore: Map<string, LiveQuote>,
  indexName: string,
  price: number,
  timestamp: number,
): Array<{ exchangeSymbol: string; quote: LiveQuote }> {
  state.liveIndexPrices.set(indexName, price);

  const updatedQuotes: Array<{ exchangeSymbol: string; quote: LiveQuote }> = [];
  const instruments = state.indexToInstruments.get(indexName);
  if (instruments == null) return updatedQuotes;

  for (const exchangeSymbol of instruments) {
    const previous = quoteStore.get(exchangeSymbol);
    if (previous == null) continue;

    updatedQuotes.push({
      exchangeSymbol,
      quote: {
        ...previous,
        underlyingPrice: price,
        indexPrice: price,
        timestamp,
      },
    });
  }

  return updatedQuotes;
}

export function buildDeribitMarkPriceQuote(
  item: DeribitMarkPriceItem,
  previous: LiveQuote | undefined,
  liveUnderlying: number | undefined,
  hasTicker: boolean,
  safeNum: (value: unknown) => number | null,
): LiveQuote {
  return {
    bidPrice: hasTicker ? (previous?.bidPrice ?? null) : null,
    askPrice: hasTicker ? (previous?.askPrice ?? null) : null,
    bidSize: hasTicker ? (previous?.bidSize ?? null) : null,
    askSize: hasTicker ? (previous?.askSize ?? null) : null,
    markPrice: item.mark_price,
    lastPrice: previous?.lastPrice ?? null,
    underlyingPrice: liveUnderlying ?? previous?.underlyingPrice ?? null,
    indexPrice: liveUnderlying ?? previous?.indexPrice ?? null,
    volume24h: previous?.volume24h ?? null,
    openInterest: previous?.openInterest ?? null,
    openInterestUsd: previous?.openInterestUsd ?? null,
    volume24hUsd: previous?.volume24hUsd ?? null,
    greeks: {
      ...(previous?.greeks ?? EMPTY_GREEKS),
      markIv: safeNum(item.iv),
    },
    timestamp: item.timestamp ?? Date.now(),
  };
}

export function buildDeribitTickerQuote(
  ticker: DeribitTicker,
  contractSize: number | null,
  safeNum: (value: unknown) => number | null,
  ivToFraction: (value: unknown) => number | null,
): LiveQuote {
  const greeks = ticker.greeks;
  const rawOpenInterest = safeNum(ticker.open_interest);
  const normalizedOpenInterest =
    rawOpenInterest != null && contractSize != null && contractSize > 0
      ? rawOpenInterest / contractSize
      : rawOpenInterest;

  return {
    bidPrice: safeNum(ticker.best_bid_price),
    askPrice: safeNum(ticker.best_ask_price),
    bidSize: safeNum(ticker.best_bid_amount),
    askSize: safeNum(ticker.best_ask_amount),
    markPrice: safeNum(ticker.mark_price),
    lastPrice: safeNum(ticker.last_price),
    underlyingPrice: safeNum(ticker.underlying_price),
    indexPrice: safeNum(ticker.index_price),
    volume24h: safeNum(ticker.stats?.volume),
    openInterest: normalizedOpenInterest,
    openInterestUsd: null,
    volume24hUsd: null,
    greeks: {
      delta: safeNum(greeks?.delta),
      gamma: safeNum(greeks?.gamma),
      theta: safeNum(greeks?.theta),
      vega: safeNum(greeks?.vega),
      rho: safeNum(greeks?.rho),
      markIv: ivToFraction(ticker.mark_iv),
      bidIv: ivToFraction(ticker.bid_iv),
      askIv: ivToFraction(ticker.ask_iv),
    },
    timestamp: ticker.timestamp ?? Date.now(),
  };
}

export function summarizeDeribitSubscribedTickerStaleness(
  subscribedTickers: ReadonlySet<string>,
  quoteStore: ReadonlyMap<string, LiveQuote>,
  now: number,
  staleAfterMs: number,
  sampleSize: number,
): DeribitSubscribedTickerStaleness | null {
  if (subscribedTickers.size === 0) return null;

  let staleSubscribedTickers = 0;
  let missingQuotes = 0;
  let oldestStaleAgeMs: number | null = null;
  let newestStaleAgeMs: number | null = null;
  const staleExamples: string[] = [];

  for (const exchangeSymbol of subscribedTickers) {
    const timestamp = quoteStore.get(exchangeSymbol)?.timestamp ?? 0;
    if (timestamp <= 0) {
      staleSubscribedTickers += 1;
      missingQuotes += 1;
      if (staleExamples.length < sampleSize) {
        staleExamples.push(exchangeSymbol);
      }
      continue;
    }

    const staleAgeMs = now - timestamp;
    if (staleAgeMs <= staleAfterMs) continue;

    staleSubscribedTickers += 1;
    if (oldestStaleAgeMs == null || staleAgeMs > oldestStaleAgeMs) {
      oldestStaleAgeMs = staleAgeMs;
    }
    if (newestStaleAgeMs == null || staleAgeMs < newestStaleAgeMs) {
      newestStaleAgeMs = staleAgeMs;
    }
    if (staleExamples.length < sampleSize) {
      staleExamples.push(exchangeSymbol);
    }
  }

  return {
    subscribedTickers: subscribedTickers.size,
    staleSubscribedTickers,
    missingQuotes,
    oldestStaleAgeMs,
    newestStaleAgeMs,
    staleExamples,
  };
}

const STALE_RECONNECT_BASE_COOLDOWN_MS = 60_000;
const STALE_RECONNECT_MAX_COOLDOWN_MS = 5 * 60_000;

/**
 * Backoff between watchdog-forced reconnects once Deribit's whole subscription
 * stream looks dead. The first forced reconnect is immediate — a one-off dead
 * socket is worth a cheap kick — but each subsequent still-dead feed doubles the
 * wait up to a ceiling. A venue-side outage cannot be fixed by reconnecting, and
 * each forced reconnect re-subscribes the full channel set; without this cap the
 * resulting snapshot bursts pile up and block the event loop.
 */
export function deribitStaleReconnectCooldownMs(forcedReconnectStreak: number): number {
  if (forcedReconnectStreak <= 0) return 0;
  const grown = STALE_RECONNECT_BASE_COOLDOWN_MS * 2 ** (forcedReconnectStreak - 1);
  return Math.min(grown, STALE_RECONNECT_MAX_COOLDOWN_MS);
}

/**
 * Decide whether the staleness watchdog should force a reconnect now. True only
 * once the stale window clears the grace period AND we are past the backoff
 * window from the previous forced reconnect (distinguishing a recoverable dead
 * socket from a persistent venue-side dead feed).
 */
export function shouldForceDeribitStaleReconnect(input: {
  staleWindowMs: number;
  graceMs: number;
  msSinceLastForcedReconnect: number | null;
  forcedReconnectStreak: number;
}): boolean {
  if (input.staleWindowMs < input.graceMs) return false;
  if (
    input.msSinceLastForcedReconnect != null &&
    input.msSinceLastForcedReconnect < deribitStaleReconnectCooldownMs(input.forcedReconnectStreak)
  ) {
    return false;
  }
  return true;
}
