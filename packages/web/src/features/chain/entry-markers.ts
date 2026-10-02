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
  feeUsd: number | null;
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
      feeUsd: f.feesUsd,
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
      feeUsd: t.feeUsd,
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

export interface BreakEvenLine {
  id: string;
  source: InstrumentEntry['source'];
  price: number;
  netQuantity: number;
}

export interface VenuePositionLeg {
  size: number;
  entryPriceUsd: number;
}

const QTY_EPSILON = 1e-9;

// Average-cost replay: adds on the open side re-weight the basis (entry fees
// included, so BE is where closing nets zero), reductions leave it untouched,
// and a flip through zero restarts the basis at the flipping fill.
export function costBasisFromEntries(
  entries: readonly InstrumentEntry[],
  priceCurrency: string | null,
  fallbackSpotUsd: number | null,
): { netQuantity: number; price: number } | null {
  let qty = 0;
  let avg = 0;
  const ordered = [...entries].sort((a, b) => a.ts - b.ts);
  for (const entry of ordered) {
    const price = toChartPrice(entry, priceCurrency, fallbackSpotUsd);
    if (price == null || !(entry.quantity > 0)) return null;
    const feePerUnit =
      entry.feeUsd != null && entry.feeUsd > 0
        ? (toChartPrice({ ...entry, priceUsd: entry.feeUsd }, priceCurrency, fallbackSpotUsd) ?? 0) /
          entry.quantity
        : 0;
    const signed = entry.side === 'buy' ? entry.quantity : -entry.quantity;
    const effective = entry.side === 'buy' ? price + feePerUnit : price - feePerUnit;

    if (Math.abs(qty) < QTY_EPSILON || Math.sign(qty) === Math.sign(signed)) {
      avg = (avg * Math.abs(qty) + effective * Math.abs(signed)) / (Math.abs(qty) + Math.abs(signed));
      qty += signed;
    } else if (Math.abs(signed) <= Math.abs(qty) + QTY_EPSILON) {
      qty += signed;
    } else {
      qty += signed;
      avg = effective;
    }
    if (Math.abs(qty) < QTY_EPSILON) {
      qty = 0;
      avg = 0;
    }
  }
  return qty === 0 ? null : { netQuantity: qty, price: avg };
}

export function buildBreakEvenLines(
  entries: readonly InstrumentEntry[],
  priceCurrency: string | null,
  fallbackSpotUsd: number | null,
  venueLeg: VenuePositionLeg | null | undefined,
): BreakEvenLine[] {
  const lines: BreakEvenLine[] = [];

  const paper = costBasisFromEntries(
    entries.filter((e) => e.source === 'paper'),
    priceCurrency,
    fallbackSpotUsd,
  );
  if (paper) lines.push({ id: 'be:paper', source: 'paper', ...paper });

  const replayed = costBasisFromEntries(
    entries.filter((e) => e.source === 'exchange'),
    priceCurrency,
    fallbackSpotUsd,
  );
  // undefined = venue not connected, so the trade replay is all we have.
  // null = connected and flat, which overrides any replayed history.
  if (venueLeg === undefined) {
    if (replayed) lines.push({ id: 'be:exchange', source: 'exchange', ...replayed });
  } else if (venueLeg !== null && venueLeg.size !== 0) {
    const replayMatches =
      replayed != null && Math.abs(replayed.netQuantity - venueLeg.size) < 1e-6;
    const venuePrice = toChartPrice(
      {
        id: 'venue',
        source: 'exchange',
        side: venueLeg.size > 0 ? 'buy' : 'sell',
        quantity: Math.abs(venueLeg.size),
        priceUsd: venueLeg.entryPriceUsd,
        feeUsd: null,
        spotUsd: null,
        ts: 0,
      },
      priceCurrency,
      fallbackSpotUsd,
    );
    const price = replayMatches ? replayed.price : venuePrice;
    if (price != null) {
      lines.push({ id: 'be:exchange', source: 'exchange', price, netQuantity: venueLeg.size });
    }
  }
  return lines;
}
