import type { CachedInstrument } from '../shared/sdk-base.js';

/**
 * Coincall requires two parallel subscriptions per chain:
 *   - bsInfo (per instrument): markPrice, iv, greeks
 *   - tOption (per base+expiry): bid/ask/bs/as/biv/aiv across the chain
 * state.ts merges them into one LiveQuote keyed by exchangeSymbol.
 *
 * tOption keys by pair root like "BTCUSD" and expiry ms (cutoff). bsInfo
 * keys by full native symbol like "BTCUSD-27MAY23-23500-C". Keep both
 * tracked independently so replay-on-reconnect emits the right mix.
 */

export const COINCALL_MAX_SUBS_PER_BATCH = 100;

export interface CoincallSubscriptionState {
  // Full native symbols subscribed to bsInfo (pricing).
  bsInfoSymbols: Set<string>;
  // Base+expiryMs keys subscribed to tOption (chain book).
  tOptionKeys: Set<string>;
}

export function createCoincallSubscriptionState(): CoincallSubscriptionState {
  return {
    bsInfoSymbols: new Set<string>(),
    tOptionKeys: new Set<string>(),
  };
}

export function tOptionKey(pairRoot: string, expirationTimestampMs: number): string {
  return `${pairRoot}:${expirationTimestampMs}`;
}

export function pairRootFor(base: string): string {
  return `${base.toUpperCase()}USD`;
}

export function buildBsInfoSubscribeMessage(
  symbol: string,
): Record<string, unknown> {
  return {
    action: 'subscribe',
    dataType: 'bsInfo',
    payload: { symbol },
  };
}

export function buildBsInfoUnsubscribeMessage(
  symbol: string,
): Record<string, unknown> {
  return {
    action: 'unsubscribe',
    dataType: 'bsInfo',
    payload: { symbol },
  };
}

export function buildTOptionSubscribeMessage(
  pairRoot: string,
  endMs: number,
): Record<string, unknown> {
  return {
    action: 'subscribe',
    dataType: 'tOption',
    payload: { symbol: pairRoot, end: endMs },
  };
}

export function buildTOptionUnsubscribeMessage(
  pairRoot: string,
  endMs: number,
): Record<string, unknown> {
  return {
    action: 'unsubscribe',
    dataType: 'tOption',
    payload: { symbol: pairRoot, end: endMs },
  };
}

/**
 * Given instruments for one (base, expiry), return the **new** bsInfo symbols
 * we should subscribe to. Mutates state to track them.
 */
export function buildCoincallNewBsInfoSymbols(
  state: CoincallSubscriptionState,
  instruments: CachedInstrument[],
): string[] {
  const fresh: string[] = [];
  for (const inst of instruments) {
    if (state.bsInfoSymbols.has(inst.exchangeSymbol)) continue;
    state.bsInfoSymbols.add(inst.exchangeSymbol);
    fresh.push(inst.exchangeSymbol);
  }
  return fresh;
}

export function buildCoincallRemovedBsInfoSymbols(
  state: CoincallSubscriptionState,
  symbols: string[],
): string[] {
  const removed: string[] = [];
  for (const sym of symbols) {
    if (!state.bsInfoSymbols.has(sym)) continue;
    state.bsInfoSymbols.delete(sym);
    removed.push(sym);
  }
  return removed;
}

export function ensureCoincallTOptionSub(
  state: CoincallSubscriptionState,
  pairRoot: string,
  expirationTimestampMs: number,
): boolean {
  const key = tOptionKey(pairRoot, expirationTimestampMs);
  if (state.tOptionKeys.has(key)) return false;
  state.tOptionKeys.add(key);
  return true;
}

export function removeCoincallTOptionSub(
  state: CoincallSubscriptionState,
  pairRoot: string,
  expirationTimestampMs: number,
): boolean {
  const key = tOptionKey(pairRoot, expirationTimestampMs);
  if (!state.tOptionKeys.has(key)) return false;
  state.tOptionKeys.delete(key);
  return true;
}

export function resetCoincallSubscriptionState(state: CoincallSubscriptionState): void {
  state.bsInfoSymbols.clear();
  state.tOptionKeys.clear();
}
