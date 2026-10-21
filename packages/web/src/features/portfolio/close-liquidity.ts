import type {
  CloseNowLeg,
  CloseNowStrategy,
  PortfolioCloseNow,
  StrategyGroup,
  StrategyGroupLeg,
} from '@oggregator/protocol';

import { fmtQty, legFillStatus } from './close-now';

const MIN_PCT_BASE_USD = 1;

export interface CloseLegQuote {
  legId: string;
  label: string;
  side: 'buy' | 'sell';
  size: number;
  quote: CloseNowLeg;
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
      /** Cash to cross every leg now, after taker fees; negative means you pay. */
      cashUsd: number;
      /** Same legs at the venue mark (mid when there is no mark); null if any leg lacks both. */
      markCashUsd: number | null;
      /** What crossing costs over the mark; positive is paid to the market maker. */
      slippageUsd: number | null;
      slippagePct: number | null;
      strategy: CloseNowStrategy | undefined;
      stale: boolean;
      legs: CloseLegQuote[];
    };

function legLabel(leg: StrategyGroupLeg): string {
  const strike = leg.strike.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return `${strike}${leg.optionRight === 'call' ? 'C' : 'P'}`;
}

/** Venue mark, else the book mid, else null. */
export function markPrice(quote: CloseNowLeg): number | null {
  if (quote.venueMarkUsd != null && quote.venueMarkUsd > 0) return quote.venueMarkUsd;
  const bid = quote.spread?.bidUsd;
  const ask = quote.spread?.askUsd;
  return bid != null && ask != null ? (bid + ask) / 2 : null;
}

export function estimateClose(
  group: StrategyGroup,
  closeNow: PortfolioCloseNow | null,
): CloseEstimate {
  if (closeNow == null) return { status: 'unavailable', reason: 'order books off' };
  const byId = new Map(closeNow.legs.map((leg) => [leg.legId, leg]));

  const legs: CloseLegQuote[] = [];
  for (const leg of group.legs) {
    const quote = byId.get(leg.legId);
    if (quote == null) return { status: 'loading' };
    if (quote.status === 'unsupported_venue') {
      return { status: 'unavailable', reason: `held on ${quote.venue ?? 'another venue'}` };
    }
    legs.push({ legId: leg.legId, label: legLabel(leg), side: quote.side, size: quote.size, quote });
  }

  const missing = legs.filter((l) => l.quote.status === 'book_unavailable');
  if (missing.length > 0) {
    return missing.every((l) => l.quote.unavailableReason === 'loading')
      ? { status: 'loading' }
      : { status: 'unavailable', reason: legFillStatus(missing[0]!.quote) };
  }

  const problems: string[] = [];
  let cashUsd = 0;
  let markCashUsd: number | null = 0;
  for (const leg of legs) {
    const { quote } = leg;
    if (quote.status !== 'ok') {
      problems.push(
        quote.filledSize > 0
          ? `${leg.label} only ${fmtQty(quote.filledSize)}/${fmtQty(quote.size)} on book`
          : `${quote.side === 'buy' ? 'no ask' : 'no bid'} on ${leg.label}`,
      );
    }
    cashUsd += quote.exitCashUsd ?? 0;
    const mark = markPrice(quote);
    const sign = quote.side === 'sell' ? 1 : -1;
    markCashUsd = markCashUsd == null || mark == null ? null : markCashUsd + sign * mark * quote.size;
  }
  if (problems.length > 0) return { status: 'no_market', problems, markCashUsd, legs };

  const slippageUsd = markCashUsd == null ? null : markCashUsd - cashUsd;
  const slippagePct =
    slippageUsd != null && markCashUsd != null && Math.abs(markCashUsd) >= MIN_PCT_BASE_USD
      ? (slippageUsd / Math.abs(markCashUsd)) * 100
      : null;
  return {
    status: 'ok',
    cashUsd,
    markCashUsd,
    slippageUsd,
    slippagePct,
    strategy: closeNow.strategies.find((s) => s.groupId === group.groupId),
    stale: legs.some((l) => l.quote.stale),
    legs,
  };
}

/** The furthest a limit order on this leg may go before Thalex rejects it. */
export function collarLimit(leg: CloseLegQuote): number | null {
  return leg.quote.collarLimitUsd;
}
