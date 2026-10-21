import type {
  CloseNowAggregate,
  CloseNowLeg,
  CloseNowUnavailableReason,
} from '@oggregator/protocol';

// Give-back bands: share of the mark gain a taker close hands back to the book.
export const GIVE_BACK_WARN_PCT = 20;
export const GIVE_BACK_ALERT_PCT = 50;
// A spread this many times its recent median reads as market makers pulling quotes.
export const SPREAD_WIDENED_RATIO = 1.5;

export const CLOSE_NOW_TOOLTIP =
  "What you'd receive closing every leg now as a taker on the holding venue, after fees.";
export const CLOSE_NOW_COMBO_NOTE =
  'Priced leg by leg; a combo or RFQ close may come in tighter.';

export type GiveBackLevel = 'ok' | 'warn' | 'alert';

export function giveBackLevel(pct: number | null | undefined): GiveBackLevel | null {
  if (pct == null || !Number.isFinite(pct)) return null;
  if (pct > GIVE_BACK_ALERT_PCT) return 'alert';
  if (pct >= GIVE_BACK_WARN_PCT) return 'warn';
  return 'ok';
}

const REASON_TEXT: Record<CloseNowUnavailableReason, string> = {
  loading: 'book loading',
  rejected: 'Thalex refused the book',
  capacity: 'book limit reached',
  unsynchronized: 'book resyncing',
  crossed: 'book crossed',
  silent: 'book feed silent',
};

export function fmtQty(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

export function fmtAge(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '—';
  if (ms < 1_000) return '<1s';
  const secs = Math.round(ms / 1_000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m`;
  return `${Math.round(mins / 60)}h`;
}

/** Short fill status for one leg: "no bid", "partial: 2 of 5 fillable", "book resyncing". */
export function legFillStatus(leg: CloseNowLeg): string {
  switch (leg.status) {
    case 'ok':
      return 'fills';
    case 'partial':
      return `partial: ${fmtQty(leg.filledSize)} of ${fmtQty(leg.size)} fillable`;
    case 'no_bid':
      return 'no bid';
    case 'no_ask':
      return 'no ask';
    case 'unsupported_venue':
      return `no ${leg.venue ?? 'venue'} depth yet`;
    case 'book_unavailable':
      return leg.unavailableReason != null ? REASON_TEXT[leg.unavailableReason] : 'no book';
  }
}

export function staleNote(leg: Pick<CloseNowLeg, 'stale' | 'unavailableReason' | 'bookAgeMs'>): string | null {
  if (!leg.stale) return null;
  const reason = leg.unavailableReason != null ? REASON_TEXT[leg.unavailableReason] : 'stale book';
  return `${reason} · last book ${fmtAge(leg.bookAgeMs)} ago`;
}

export function spreadNote(leg: CloseNowLeg): string | null {
  const spread = leg.spread;
  if (spread?.widthPct == null) return null;
  const width = `spread ${spread.widthPct.toFixed(1)}%`;
  if (spread.typicalWidthPct == null || spread.widthVsTypical == null) return `${width} (typical: sampling)`;
  const typical = `typical ${spread.typicalWidthPct.toFixed(1)}%`;
  return spread.widthVsTypical >= SPREAD_WIDENED_RATIO
    ? `${width} · ${spread.widthVsTypical.toFixed(1)}× ${typical}: quotes pulled`
    : `${width} · ${typical}`;
}

export function coverageNote(aggregate: CloseNowAggregate): string | null {
  if (aggregate.complete) return null;
  return `${aggregate.pricedLegCount} of ${aggregate.legCount} legs closable`;
}
