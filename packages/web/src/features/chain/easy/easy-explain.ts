import { pnlAtPrice, type Leg, type PriceZone } from '@features/architect';
import { normCdf } from '@lib/analytics/blackScholes';
import { fmtUsd } from '@lib/format';
import { translate, type Locale } from '@lib/i18n';

import { easyMessages, type EasyMessageKey } from './i18n';

export interface EasyLegDraft {
  type: 'call' | 'put';
  direction: 'buy' | 'sell';
  strike: number;
}

export const EASY_OPTION_MIME = 'application/x-oggregator-option';

export function encodeDraft(draft: EasyLegDraft): string {
  return JSON.stringify(draft);
}

export function decodeDraft(raw: string): EasyLegDraft | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed == null) return null;
    const { type, direction, strike } = parsed as Record<string, unknown>;
    if (type !== 'call' && type !== 'put') return null;
    if (direction !== 'buy' && direction !== 'sell') return null;
    if (typeof strike !== 'number' || !Number.isFinite(strike) || strike <= 0) return null;
    return { type, direction, strike };
  } catch {
    return null;
  }
}

/** Splits the price axis at the break-evens and labels each band profit/loss at expiry. */
export function profitZones(legs: Leg[], breakevens: number[], spot: number): PriceZone[] {
  if (legs.length === 0) return [];
  const sorted = [...breakevens].sort((a, b) => a - b);
  const bounds = [-Infinity, ...sorted, Infinity];
  const zones: PriceZone[] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const low = bounds[i]!;
    const high = bounds[i + 1]!;
    let probe: number;
    if (Number.isFinite(low) && Number.isFinite(high)) probe = (low + high) / 2;
    else if (Number.isFinite(high)) probe = high * 0.5;
    else if (Number.isFinite(low)) probe = low * 1.5;
    else probe = spot;
    zones.push({ low, high, profit: pnlAtPrice(legs, probe) > 0 });
  }
  return zones;
}

/**
 * Risk-neutral chance the underlying finishes inside a profit band, from a
 * lognormal around the forward at one flat IV. It ignores skew, so treat it as
 * a rough guide for beginners rather than a precise probability.
 */
export function chanceOfProfit(
  zones: PriceZone[],
  forward: number,
  iv: number | null,
  years: number,
): number | null {
  if (zones.length === 0 || iv == null || iv <= 0 || forward <= 0 || years <= 0) return null;
  const sd = iv * Math.sqrt(years);
  const probAbove = (x: number): number => {
    if (x === -Infinity || x <= 0) return 1;
    if (x === Infinity) return 0;
    return normCdf((Math.log(forward / x) - 0.5 * sd * sd) / sd);
  };
  let total = 0;
  for (const z of zones) {
    if (z.profit) total += probAbove(z.low) - probAbove(z.high);
  }
  return Math.min(1, Math.max(0, total));
}

function fmtPrice(v: number): string {
  return `$${v.toLocaleString('en-US', { maximumFractionDigits: v >= 100 ? 0 : 2 })}`;
}

export function legTitle(leg: Pick<Leg, 'type' | 'direction' | 'strike'>, locale: Locale): string {
  const verb = translate(easyMessages, leg.direction === 'buy' ? 'legBuy' : 'legSell', undefined, locale);
  const view = translate(easyMessages, leg.type === 'call' ? 'legUp' : 'legDown', undefined, locale);
  return `${verb} ${view} ${fmtPrice(leg.strike)}`;
}

export function describeLeg(leg: Leg, underlying: string, locale: Locale): string {
  const qty = leg.quantity * (leg.contractMultiplier ?? 1);
  const premium = leg.entryPrice * qty;
  const above = leg.type === 'call';
  const be = above ? leg.strike + leg.entryPrice : leg.strike - leg.entryPrice;
  const vars = {
    premium: fmtUsd(premium),
    underlying,
    strike: fmtPrice(leg.strike),
    be: fmtPrice(be),
  };
  const key: EasyMessageKey =
    leg.direction === 'buy'
      ? above
        ? 'describeBuyAbove'
        : 'describeBuyBelow'
      : above
        ? 'describeSellCall'
        : 'describeSellPut';
  return translate(easyMessages, key, vars, locale);
}

const STRATEGY_BLURBS: Record<string, EasyMessageKey> = {
  'Long Call': 'blurbLongCall',
  'Long Put': 'blurbLongPut',
  'Short Call': 'blurbShortCall',
  'Short Put': 'blurbShortPut',
  'Bull Call Spread': 'blurbBullCallSpread',
  'Bear Call Spread': 'blurbBearCallSpread',
  'Bear Put Spread': 'blurbBearPutSpread',
  'Bull Put Spread': 'blurbBullPutSpread',
  'Long Straddle': 'blurbLongStraddle',
  'Long Strangle': 'blurbLongStrangle',
  'Short Straddle': 'blurbShortStraddle',
  'Short Strangle': 'blurbShortStrangle',
  'Iron Condor': 'blurbIronCondor',
  'Iron Butterfly': 'blurbIronButterfly',
  'Call Butterfly': 'blurbButterfly',
  'Put Butterfly': 'blurbButterfly',
};

export function describeStrategy(name: string, locale: Locale): string {
  return translate(easyMessages, STRATEGY_BLURBS[name] ?? 'blurbCustom', undefined, locale);
}
