import { intlLocale, type Locale, translate } from '@lib/i18n';
import type {
  ThesisClassification,
  ThesisDiffKey,
  ThesisDirection,
  ThesisStatus,
} from '@oggregator/protocol';

import { thesisMessages } from './i18n';

export const fmtPrice = (value: number | null | undefined) =>
  value == null ? '—' : Math.round(value).toLocaleString('en-US');

export const fmtUsdSigned = (value: number | null | undefined) =>
  value == null ? '—' : `${value >= 0 ? '+' : '−'}$${Math.abs(Math.round(value)).toLocaleString('en-US')}`;

export function fmtExpiry(expiry: string, locale: Locale = 'en'): string {
  const date = new Date(`${expiry}T08:00:00Z`);
  return date
    .toLocaleDateString(locale === 'en' ? 'en-GB' : intlLocale(locale), {
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    })
    .replace(/\./g, '')
    .toUpperCase();
}

export function fmtDuration(ms: number): string {
  const hours = ms / 3_600_000;
  if (hours < 1) return `${Math.max(1, Math.round(ms / 60_000))}m`;
  if (hours < 48) return `${hours.toFixed(hours < 10 ? 1 : 0)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

export function fmtAge(createdAt: number, locale: Locale = 'en', nowMs = Date.now()): string {
  const days = Math.floor((nowMs - createdAt) / 86_400_000);
  if (days >= 1) {
    return translate(thesisMessages, days === 1 ? 'daysAgo_one' : 'daysAgo_other', { n: days }, locale);
  }
  return translate(thesisMessages, 'durationAgo', { d: fmtDuration(nowMs - createdAt) }, locale);
}

export const confirmLabel = (confirmSec: number) => (confirmSec === 86400 ? '1D' : '4H');

export const wrongIfText = (
  direction: ThesisDirection,
  level: number,
  confirmSec: number,
  locale: Locale = 'en',
) =>
  translate(
    thesisMessages,
    direction === 'bearish' ? 'wrongIfAbove' : 'wrongIfBelow',
    { tf: confirmLabel(confirmSec), level: fmtPrice(level) },
    locale,
  );

export const statusLabel = (status: ThesisStatus, locale: Locale = 'en') =>
  translate(thesisMessages, `status_${status}`, undefined, locale);

export const diffLabel = (key: ThesisDiffKey, locale: Locale = 'en') =>
  translate(thesisMessages, `diff_${key}`, undefined, locale);

export const classificationLabel = (value: ThesisClassification, locale: Locale = 'en') =>
  translate(thesisMessages, `cls_${value}`, undefined, locale);

export function fmtDiffValue(key: ThesisDiffKey, value: number | null): string {
  if (value == null) return '—';
  if (key === 'spot') return fmtPrice(value);
  if (key === 'netGex') return `${value >= 0 ? '+' : ''}${value.toFixed(1)}M`;
  const points = value * 100;
  return key === 'skew25d' ? `${points >= 0 ? '+' : ''}${points.toFixed(1)}` : points.toFixed(1);
}
