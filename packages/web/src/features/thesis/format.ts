import type { ThesisDiffKey, ThesisDirection, ThesisStatus } from '@oggregator/protocol';

export const fmtPrice = (value: number | null | undefined) =>
  value == null ? '—' : Math.round(value).toLocaleString('en-US');

export const fmtUsdSigned = (value: number | null | undefined) =>
  value == null ? '—' : `${value >= 0 ? '+' : '−'}$${Math.abs(Math.round(value)).toLocaleString('en-US')}`;

export function fmtExpiry(expiry: string): string {
  const date = new Date(`${expiry}T08:00:00Z`);
  return date
    .toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
    .toUpperCase();
}

export function fmtDuration(ms: number): string {
  const hours = ms / 3_600_000;
  if (hours < 1) return `${Math.max(1, Math.round(ms / 60_000))}m`;
  if (hours < 48) return `${hours.toFixed(hours < 10 ? 1 : 0)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

export function fmtAge(createdAt: number, nowMs = Date.now()): string {
  const days = Math.floor((nowMs - createdAt) / 86_400_000);
  if (days >= 1) return `${days} day${days === 1 ? '' : 's'} ago`;
  return `${fmtDuration(nowMs - createdAt)} ago`;
}

export const confirmLabel = (confirmSec: number) => (confirmSec === 86400 ? '1D' : '4H');

export const wrongIfText = (direction: ThesisDirection, level: number, confirmSec: number) =>
  `a ${confirmLabel(confirmSec)} candle closes ${direction === 'bearish' ? 'above' : 'below'} ${fmtPrice(level)}`;

export const STATUS_LABEL: Record<ThesisStatus, string> = {
  INTACT: 'Intact',
  AT_RISK: 'At risk',
  INVALIDATED: 'Invalidated',
  EXPIRED: 'Expired',
};

export const DIFF_LABEL: Record<ThesisDiffKey, string> = {
  spot: 'Spot',
  dvol: 'DVOL',
  atmIv: 'ATM IV (horizon)',
  skew25d: '25Δ skew (horizon)',
  netGex: 'Net GEX',
};

export function fmtDiffValue(key: ThesisDiffKey, value: number | null): string {
  if (value == null) return '—';
  if (key === 'spot') return fmtPrice(value);
  if (key === 'netGex') return `${value >= 0 ? '+' : ''}${value.toFixed(1)}M`;
  const points = value * 100;
  return key === 'skew25d' ? `${points >= 0 ? '+' : ''}${points.toFixed(1)}` : points.toFixed(1);
}
