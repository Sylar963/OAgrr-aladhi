import type {
  ExchangePortfolioTrade,
  InstrumentCandle,
  PaperFillDto,
  VenueId,
} from '@oggregator/protocol';

export interface InstrumentKey {
  venue: VenueId;
  underlying: string;
  expiry: string;
  strike: number;
  type: 'call' | 'put';
}

export interface InstrumentEntry {
  id: string;
  source: 'paper' | 'exchange';
  side: 'buy' | 'sell';
  quantity: number;
  priceUsd: number;
  spotUsd: number | null;
  ts: number;
}

export interface EntryMarker {
  id: string;
  barTs: number;
  price: number;
  side: 'buy' | 'sell';
  text: string;
}

export function paperFillEntries(
  fills: readonly PaperFillDto[],
  key: InstrumentKey,
): InstrumentEntry[] {
  return fills
    .filter(
      (f) =>
        f.venue === key.venue &&
        f.underlying === key.underlying &&
        f.expiry === key.expiry &&
        f.strike === key.strike &&
        f.optionRight === key.type,
    )
    .map((f) => ({
      id: `paper:${f.id}`,
      source: 'paper' as const,
      side: f.side,
      quantity: f.quantity,
      priceUsd: f.priceUsd,
      spotUsd: f.underlyingSpotUsd,
      ts: Date.parse(f.filledAt),
    }));
}

export function exchangeTradeEntries(
  trades: readonly ExchangePortfolioTrade[],
  key: InstrumentKey,
): InstrumentEntry[] {
  return trades
    .filter(
      (t) =>
        t.venue === key.venue &&
        t.underlying === key.underlying &&
        t.expiry === key.expiry &&
        t.strike === key.strike &&
        t.optionRight === key.type,
    )
    .map((t) => ({
      id: `exchange:${t.venue}:${t.tradeId}`,
      source: 'exchange' as const,
      side: t.direction,
      quantity: t.amount,
      priceUsd: t.priceUsd,
      spotUsd: null,
      ts: t.timestampMs,
    }));
}

function isInverseCurrency(priceCurrency: string | null): boolean {
  return priceCurrency === 'BTC' || priceCurrency === 'ETH';
}

// Inverse charts (Deribit, OKX coin-margined) draw premiums in base currency,
// while fills are stored in USD. Convert with the spot recorded at fill time;
// fall back to the current spot only when the fill didn't capture one.
export function toChartPrice(
  entry: InstrumentEntry,
  priceCurrency: string | null,
  fallbackSpotUsd: number | null,
): number | null {
  if (!isInverseCurrency(priceCurrency)) return entry.priceUsd;
  const spot = entry.spotUsd ?? fallbackSpotUsd;
  if (spot == null || !(spot > 0)) return null;
  return entry.priceUsd / spot;
}

// lightweight-charts only places markers on existing bar times, so each fill
// lands on the bar that contains it. Fills older than the loaded range are
// dropped rather than piled onto the first bar.
export function snapToBarTs(ts: number, candles: readonly InstrumentCandle[]): number | null {
  if (candles.length === 0 || !Number.isFinite(ts) || ts < candles[0]!.ts) return null;
  let lo = 0;
  let hi = candles.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (candles[mid]!.ts <= ts) lo = mid;
    else hi = mid - 1;
  }
  return candles[lo]!.ts;
}

function formatQuantity(q: number): string {
  return Number(q.toPrecision(6)).toString();
}

export function buildEntryMarkers(
  entries: readonly InstrumentEntry[],
  candles: readonly InstrumentCandle[],
  priceCurrency: string | null,
  fallbackSpotUsd: number | null,
  precision: number,
): EntryMarker[] {
  const markers: EntryMarker[] = [];
  for (const entry of entries) {
    const barTs = snapToBarTs(entry.ts, candles);
    if (barTs == null) continue;
    const price = toChartPrice(entry, priceCurrency, fallbackSpotUsd);
    if (price == null) continue;
    const tag = entry.source === 'paper' ? 'paper' : 'live';
    markers.push({
      id: entry.id,
      barTs,
      price,
      side: entry.side,
      text: `${entry.side === 'buy' ? 'B' : 'S'} ${formatQuantity(entry.quantity)} @ ${price.toFixed(precision)} · ${tag}`,
    });
  }
  return markers.sort((a, b) => a.barTs - b.barTs);
}
