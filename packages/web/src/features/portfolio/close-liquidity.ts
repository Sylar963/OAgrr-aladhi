import { fetchJson } from '@lib/http';
import { thalexOptionSymbol } from '@lib/thalex-symbol';
import {
  type LiquidityCloseItem,
  LiquidityCloseResponseSchema,
  type LiquidityCloseResponse,
  liquidityLegParam,
  type LiquidityQuery,
  type PositionLeg,
  type StrategyGroup,
  type StrategyGroupLeg,
} from '@oggregator/protocol';

// Only legs held on Thalex, or not on any venue, are priced against the Thalex book.
const VENUE_NEUTRAL_SOURCES = new Set<PositionLeg['source']>(['manual', 'paper']);
const MIN_PCT_BASE_USD = 1;

export interface CloseLegQuote {
  legId: string;
  label: string;
  query: LiquidityQuery;
  item: LiquidityCloseItem | undefined;
}

export type CloseEstimate =
  | { status: 'loading' }
  | { status: 'unavailable'; reason: string }
  | {
      status: 'no_market';
      problems: string[];
      /** The whole package at mark: the fair price to work a limit order or RFQ at. */
      markCashUsd: number | null;
      legs: CloseLegQuote[];
    }
  | {
      status: 'ok';
      /** Cash to cross every leg now; negative means you pay. */
      cashUsd: number;
      /** Same legs at the venue mark (mid when there is no mark); null if any leg lacks both. */
      markCashUsd: number | null;
      /** What crossing costs over the mark; positive is paid to the market maker. */
      slippageUsd: number | null;
      slippagePct: number | null;
      legs: CloseLegQuote[];
    };

function heldElsewhere(position: PositionLeg | undefined): string | null {
  if (position == null) return null;
  if (position.venueHint != null && position.venueHint !== 'thalex') return position.venueHint;
  if (position.source !== 'thalex' && !VENUE_NEUTRAL_SOURCES.has(position.source)) {
    return position.source;
  }
  return null;
}

function legLabel(leg: StrategyGroupLeg): string {
  const strike = leg.strike.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return `${strike}${leg.optionRight === 'call' ? 'C' : 'P'}`;
}

export function closeQuery(group: StrategyGroup, leg: StrategyGroupLeg): LiquidityQuery {
  return {
    instrument: thalexOptionSymbol({ ...leg, underlying: group.underlying, expiry: group.expiry }),
    side: leg.size > 0 ? 'sell' : 'buy',
    size: Math.abs(leg.size),
  };
}

/** Every distinct leg query the panel needs priced, as `leg` query params. */
export function closeLegParams(
  groups: StrategyGroup[],
  positionsById: ReadonlyMap<string, PositionLeg>,
): string[] {
  const params = new Set<string>();
  for (const group of groups) {
    if (group.legs.some((leg) => heldElsewhere(positionsById.get(leg.legId)) != null)) continue;
    for (const leg of group.legs) params.add(liquidityLegParam(closeQuery(group, leg)));
  }
  return [...params].sort();
}

function itemKey(item: LiquidityCloseItem): string {
  return liquidityLegParam({ instrument: item.instrument, side: item.side, size: item.size });
}

export function indexCloseItems(
  response: LiquidityCloseResponse | undefined,
): ReadonlyMap<string, LiquidityCloseItem> {
  return new Map((response?.items ?? []).map((item) => [itemKey(item), item]));
}

function fmtQty(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

const ERROR_TEXT: Record<NonNullable<LiquidityCloseItem['error']>, string> = {
  unsupported: 'no Thalex book',
  rejected: 'not listed on Thalex',
  timeout: 'book not loading',
  capacity: 'book limit reached',
  disposed: 'books offline',
};

export function markPrice(item: LiquidityCloseItem): number | null {
  const quote = item.quote;
  if (quote == null) return null;
  if (quote.mark != null && quote.mark.markPrice > 0) return quote.mark.markPrice;
  if (quote.bestBid != null && quote.bestAsk != null) return (quote.bestBid + quote.bestAsk) / 2;
  return null;
}

export function estimateClose(
  group: StrategyGroup,
  positionsById: ReadonlyMap<string, PositionLeg>,
  items: ReadonlyMap<string, LiquidityCloseItem>,
  loaded: boolean,
): CloseEstimate {
  for (const leg of group.legs) {
    const venue = heldElsewhere(positionsById.get(leg.legId));
    if (venue != null) return { status: 'unavailable', reason: `held on ${venue}` };
  }
  if (!loaded) return { status: 'loading' };

  const legs: CloseLegQuote[] = group.legs.map((leg) => {
    const query = closeQuery(group, leg);
    return { legId: leg.legId, label: legLabel(leg), query, item: items.get(liquidityLegParam(query)) };
  });

  const failed = legs.find((l) => l.item == null || l.item.error != null);
  if (failed) {
    const error = failed.item?.error;
    return { status: 'unavailable', reason: error != null ? ERROR_TEXT[error] : 'no quote' };
  }

  const problems: string[] = [];
  let cashUsd = 0;
  let markCashUsd: number | null = 0;
  for (const leg of legs) {
    const fill = leg.item!.quote!.fill;
    const sign = leg.query.side === 'sell' ? 1 : -1;
    if (!fill.fullyFilled) {
      const missing = leg.query.side === 'buy' ? 'no ask' : 'no bid';
      problems.push(
        fill.filled > 0
          ? `${leg.label} only ${fmtQty(fill.filled)}/${fmtQty(fill.requested)} on book`
          : `${missing} on ${leg.label}`,
      );
    }
    cashUsd += sign * fill.notional;
    const mark = markPrice(leg.item!);
    markCashUsd = markCashUsd == null || mark == null ? null : markCashUsd + sign * mark * leg.query.size;
  }
  if (problems.length > 0) return { status: 'no_market', problems, markCashUsd, legs };

  const slippageUsd = markCashUsd == null ? null : markCashUsd - cashUsd;
  const slippagePct =
    slippageUsd != null && markCashUsd != null && Math.abs(markCashUsd) >= MIN_PCT_BASE_USD
      ? (slippageUsd / Math.abs(markCashUsd)) * 100
      : null;
  return { status: 'ok', cashUsd, markCashUsd, slippageUsd, slippagePct, legs };
}

export async function fetchCloseLiquidity(params: string[]): Promise<LiquidityCloseResponse> {
  const search = new URLSearchParams(params.map((leg) => ['leg', leg]));
  const body = await fetchJson<unknown>(`/liquidity/close?${search.toString()}`);
  return LiquidityCloseResponseSchema.parse(body);
}

/** The furthest a limit order on this leg may go before Thalex rejects it. */
export function collarLimit(leg: CloseLegQuote): number | null {
  const mark = leg.item?.quote?.mark;
  if (mark == null) return null;
  return leg.query.side === 'buy' ? mark.collarHigh : mark.collarLow;
}
