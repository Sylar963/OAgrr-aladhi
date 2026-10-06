import type { SpotCandle } from './queries';

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

export interface ExpiryMark {
  expiryMs: number;
  label: string;
  nearest: boolean;
}

export interface BreakevenCrossing {
  timestamp: number;
  label: string;
}

export function expiryTimeMs(expiry: string, market: 'crypto' | 'tradfi'): number {
  return Date.parse(`${expiry}T${market === 'tradfi' ? '21' : '08'}:00:00Z`);
}

export function fmtDayMonth(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

export function fmtTimeLeft(ms: number): string {
  if (ms <= 0) return '0h';
  if (ms < MS_PER_DAY) return `${Math.max(1, Math.round(ms / MS_PER_HOUR))}h`;
  return `${Math.round((ms / MS_PER_DAY) * 10) / 10}d`;
}

export function buildExpiryMarks(
  expiries: readonly string[],
  market: 'crypto' | 'tradfi',
  nowMs: number,
): ExpiryMark[] {
  const times = [...new Set(expiries.filter(Boolean))]
    .map((e) => expiryTimeMs(e, market))
    .filter((ms) => Number.isFinite(ms) && ms > nowMs)
    .sort((a, b) => a - b);
  return times.map((expiryMs, i) => ({
    expiryMs,
    label: `EXP ${fmtDayMonth(expiryMs)} · ${fmtTimeLeft(expiryMs - nowMs)}`,
    nearest: i === 0,
  }));
}

/**
 * First projected bar whose close sits on the other side of a break-even from
 * the path's starting price — i.e. the day the move has to have happened by.
 */
export function findBreakevenCrossing(
  candles: readonly SpotCandle[],
  breakevens: readonly number[],
  expiryMs: number,
): BreakevenCrossing | null {
  if (candles.length === 0 || breakevens.length === 0) return null;
  const start = candles[0]!.open;
  for (const candle of candles) {
    const crossed = breakevens.some(
      (be) => (start - be) * (candle.close - be) < 0 || (start !== be && candle.close === be),
    );
    if (crossed) {
      return {
        timestamp: candle.timestamp,
        label: `BE ${fmtDayMonth(candle.timestamp)} · ${fmtTimeLeft(expiryMs - candle.timestamp)} left`,
      };
    }
  }
  return null;
}
