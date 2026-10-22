import type {
  CloseNowAggregate,
  CloseNowLeg,
  CloseNowUnavailableReason,
} from '@oggregator/protocol';

import { defineMessages, translate, type Locale } from '@lib/i18n';

// Give-back bands: share of the mark gain a taker close hands back to the book.
export const GIVE_BACK_WARN_PCT = 20;
export const GIVE_BACK_ALERT_PCT = 50;
// A spread this many times its recent median reads as market makers pulling quotes.
export const SPREAD_WIDENED_RATIO = 1.5;

export const closeNowMessages = defineMessages(
  {
    tooltip: "What you'd receive closing every leg now as a taker on the holding venue, after fees.",
    comboNote: 'Priced leg by leg; a combo or RFQ close may come in tighter.',
    reason_loading: 'book loading',
    reason_rejected: 'Thalex refused the book',
    reason_capacity: 'book limit reached',
    reason_unsynchronized: 'book resyncing',
    reason_crossed: 'book crossed',
    reason_silent: 'book feed silent',
    fills: 'fills',
    partial: 'partial: {filled} of {size} fillable',
    noBid: 'no bid',
    noAsk: 'no ask',
    noDepth: 'no {venue} depth yet',
    venueFallback: 'venue',
    noBook: 'no book',
    staleBook: 'stale book',
    staleNote: '{reason} · last book {age} ago',
    spread: 'spread {pct}%',
    typicalSampling: '{width} (typical: sampling)',
    typical: 'typical {pct}%',
    quotesPulled: '{width} · {ratio}× {typical}: quotes pulled',
    widthTypical: '{width} · {typical}',
    coverage: '{priced} of {total} legs closable',
  },
  {
    tooltip:
      'Lo que recibirías cerrando todos los legs ahora como taker en el exchange donde están, después de comisiones.',
    comboNote: 'Cotizado leg por leg; un cierre por combo o RFQ podría salir más ajustado.',
    reason_loading: 'cargando libro',
    reason_rejected: 'Thalex rechazó el libro',
    reason_capacity: 'límite de libros alcanzado',
    reason_unsynchronized: 'resincronizando libro',
    reason_crossed: 'libro cruzado',
    reason_silent: 'feed del libro en silencio',
    fills: 'se ejecuta',
    partial: 'parcial: {filled} de {size} ejecutables',
    noBid: 'sin bid',
    noAsk: 'sin ask',
    noDepth: 'aún sin profundidad de {venue}',
    venueFallback: 'exchange',
    noBook: 'sin libro',
    staleBook: 'libro desactualizado',
    staleNote: '{reason} · último libro hace {age}',
    spread: 'spread {pct}%',
    typicalSampling: '{width} (típico: muestreando)',
    typical: 'típico {pct}%',
    quotesPulled: '{width} · {ratio}× {typical}: cotizaciones retiradas',
    widthTypical: '{width} · {typical}',
    coverage: '{priced} de {total} legs cerrables',
  },
);

export type GiveBackLevel = 'ok' | 'warn' | 'alert';

export function giveBackLevel(pct: number | null | undefined): GiveBackLevel | null {
  if (pct == null || !Number.isFinite(pct)) return null;
  if (pct > GIVE_BACK_ALERT_PCT) return 'alert';
  if (pct >= GIVE_BACK_WARN_PCT) return 'warn';
  return 'ok';
}

function reasonText(reason: CloseNowUnavailableReason, locale: Locale): string {
  return translate(closeNowMessages, `reason_${reason}`, undefined, locale);
}

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
export function legFillStatus(leg: CloseNowLeg, locale: Locale = 'en'): string {
  const t = (key: keyof typeof closeNowMessages.en, vars?: Record<string, string | number>) =>
    translate(closeNowMessages, key, vars, locale);
  switch (leg.status) {
    case 'ok':
      return t('fills');
    case 'partial':
      return t('partial', { filled: fmtQty(leg.filledSize), size: fmtQty(leg.size) });
    case 'no_bid':
      return t('noBid');
    case 'no_ask':
      return t('noAsk');
    case 'unsupported_venue':
      return t('noDepth', { venue: leg.venue ?? t('venueFallback') });
    case 'book_unavailable':
      return leg.unavailableReason != null ? reasonText(leg.unavailableReason, locale) : t('noBook');
  }
}

export function staleNote(
  leg: Pick<CloseNowLeg, 'stale' | 'unavailableReason' | 'bookAgeMs'>,
  locale: Locale = 'en',
): string | null {
  if (!leg.stale) return null;
  const reason =
    leg.unavailableReason != null
      ? reasonText(leg.unavailableReason, locale)
      : translate(closeNowMessages, 'staleBook', undefined, locale);
  return translate(closeNowMessages, 'staleNote', { reason, age: fmtAge(leg.bookAgeMs) }, locale);
}

export function spreadNote(leg: CloseNowLeg, locale: Locale = 'en'): string | null {
  const t = (key: keyof typeof closeNowMessages.en, vars?: Record<string, string | number>) =>
    translate(closeNowMessages, key, vars, locale);
  const spread = leg.spread;
  if (spread?.widthPct == null) return null;
  const width = t('spread', { pct: spread.widthPct.toFixed(1) });
  if (spread.typicalWidthPct == null || spread.widthVsTypical == null) return t('typicalSampling', { width });
  const typical = t('typical', { pct: spread.typicalWidthPct.toFixed(1) });
  return spread.widthVsTypical >= SPREAD_WIDENED_RATIO
    ? t('quotesPulled', { width, ratio: spread.widthVsTypical.toFixed(1), typical })
    : t('widthTypical', { width, typical });
}

export function coverageNote(aggregate: CloseNowAggregate, locale: Locale = 'en'): string | null {
  if (aggregate.complete) return null;
  return translate(
    closeNowMessages,
    'coverage',
    { priced: aggregate.pricedLegCount, total: aggregate.legCount },
    locale,
  );
}
