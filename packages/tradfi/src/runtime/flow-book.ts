const ET = 'America/New_York';

/** ET calendar-day key (YYYY-MM-DD) — the session boundary for flow reset. */
export function etDayKey(nowMs: number): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: ET, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(nowMs));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/**
 * Lee-Ready trade-side classification. Quote rule first (trade vs prevailing
 * bid/ask mid), tick rule as fallback for at-mid / no-quote prints, carrying the
 * prior tick direction on a zero tick. +1 = buy-initiated, −1 = sell-initiated.
 */
export function classifyTrade(
  price: number,
  bid: number | null,
  ask: number | null,
  lastPrice: number | null,
  lastDir: 1 | -1,
): 1 | -1 {
  if (bid != null && ask != null) {
    const mid = (bid + ask) / 2;
    if (price > mid) return 1;
    if (price < mid) return -1;
  }
  if (lastPrice != null) {
    if (price > lastPrice) return 1;
    if (price < lastPrice) return -1;
  }
  return lastDir;
}

interface FlowState {
  netFlow: number; // signed customer contracts this session: + net buy, − net sell
  lastTradePrice: number | null;
  lastTickDir: 1 | -1;
}

/**
 * In-memory per-contract net taker flow, keyed by canonical option symbol.
 * Customer-buy is positive. Self-resets on ET-day rollover: the first trade of a
 * new session clears the whole map. No persistence — the signed book is
 * reconstructable from live OI (held by the chain) plus this session's flow.
 */
export class TradfiFlowBook {
  private flow = new Map<string, FlowState>();
  private sessionDayKey: string | null = null;

  recordTrade(
    canonical: string,
    price: number | null,
    size: number | null,
    bid: number | null,
    ask: number | null,
    nowMs: number = Date.now(),
  ): void {
    if (price == null || size == null || size <= 0) return;
    const day = etDayKey(nowMs);
    if (day !== this.sessionDayKey) {
      this.flow.clear();
      this.sessionDayKey = day;
    }
    const st = this.flow.get(canonical) ?? {
      netFlow: 0,
      lastTradePrice: null,
      lastTickDir: 1 as 1 | -1,
    };
    const dir = classifyTrade(price, bid, ask, st.lastTradePrice, st.lastTickDir);
    st.netFlow += dir * size;
    st.lastTradePrice = price;
    st.lastTickDir = dir;
    this.flow.set(canonical, st);
  }

  netFlowFor(canonical: string): number {
    return this.flow.get(canonical)?.netFlow ?? 0;
  }

  resetSession(): void {
    this.flow.clear();
    this.sessionDayKey = null;
  }

  size(): number {
    return this.flow.size;
  }
}
