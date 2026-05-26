import type { OptionRight } from '../types/common.js';

export interface CanonicalOption {
  base: string;
  quote: string;
  settle: string;
  expiry: string; // YYYY-MM-DD
  expiryCode: string; // YYMMDD
  strike: number;
  right: OptionRight;
}

// Parsing the same symbol string always yields the same result, but under a
// venue reconnect's ticker burst this is called once per delta × per active
// request entry — tens of thousands of identical regex parses in a tight loop
// (the dominant event-loop-blocking frame in CPU profiling). The result is
// memoized on the symbol string so each distinct symbol is parsed once; repeat
// lookups are an O(1) Map hit. Returned objects are frozen because they are now
// shared across callers — every consumer treats the parse result as read-only.
const MAX_PARSE_CACHE_ENTRIES = 20_000;
const parseCache = new Map<string, Readonly<CanonicalOption> | null>();

/** Parse a CCXT unified option symbol into canonical parts (memoized) */
export function parseOptionSymbol(symbol: string): Readonly<CanonicalOption> | null {
  const cached = parseCache.get(symbol);
  if (cached !== undefined) return cached;

  const parsed = parseOptionSymbolUncached(symbol);

  // Bound memory: the live instrument universe is finite (~thousands) but rolls
  // over time as expiries list/delist. Evict the oldest entry (Map preserves
  // insertion order) on overflow instead of clearing the whole cache.
  if (parseCache.size >= MAX_PARSE_CACHE_ENTRIES) {
    const oldest = parseCache.keys().next().value;
    if (oldest !== undefined) parseCache.delete(oldest);
  }
  parseCache.set(symbol, parsed);
  return parsed;
}

function parseOptionSymbolUncached(symbol: string): Readonly<CanonicalOption> | null {
  // BTC/USD:BTC-250628-60000-C
  const match = symbol.match(/^(\w+)\/(\w+):(\w+)-(\d{6})-(\d+(?:\.\d+)?)-([CP])$/);
  if (!match) return null;

  const [, base, quote, settle, expiryCode, strikeStr, rightChar] = match as RegExpMatchArray;
  const yy = expiryCode!.slice(0, 2);
  const mm = expiryCode!.slice(2, 4);
  const dd = expiryCode!.slice(4, 6);

  return Object.freeze({
    base: base!,
    quote: quote!,
    settle: settle!,
    expiry: `20${yy}-${mm}-${dd}`,
    expiryCode: expiryCode!,
    strike: Number(strikeStr),
    right: rightChar === 'C' ? 'call' : 'put',
  });
}

/** Build a CCXT unified option symbol from parts */
export function formatOptionSymbol(opt: CanonicalOption): string {
  const rightChar = opt.right === 'call' ? 'C' : 'P';
  return `${opt.base}/${opt.quote}:${opt.settle}-${opt.expiryCode}-${opt.strike}-${rightChar}`;
}

/** Create a strike-level key for grouping calls+puts across venues */
export function strikeKey(base: string, expiry: string, strike: number): string {
  return `${base}:${expiry}:${strike}`;
}
