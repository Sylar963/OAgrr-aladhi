import type { PositionLeg } from '@oggregator/protocol';

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** Thalex option symbol for a portfolio leg: BTC-23OCT26-84000-C. */
export function thalexOptionSymbol(leg: Pick<PositionLeg, 'underlying' | 'expiry' | 'strike' | 'optionRight'>): string {
  const [year, month, day] = leg.expiry.split('-');
  const monthName = MONTHS[Number(month) - 1] ?? '';
  return `${leg.underlying.toUpperCase()}-${day}${monthName}${year?.slice(2)}-${leg.strike}-${leg.optionRight === 'call' ? 'C' : 'P'}`;
}
