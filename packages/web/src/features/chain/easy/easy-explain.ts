import { pnlAtPrice, type Leg, type PriceZone } from '@features/architect';
import { normCdf } from '@lib/analytics/blackScholes';
import { fmtUsd } from '@lib/format';

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

export function legTitle(leg: Pick<Leg, 'type' | 'direction' | 'strike'>): string {
  const verb = leg.direction === 'buy' ? 'Buy' : 'Sell';
  const view = leg.type === 'call' ? '▲ UP' : '▼ DOWN';
  return `${verb} ${view} ${fmtPrice(leg.strike)}`;
}

export function describeLeg(leg: Leg, underlying: string): string {
  const qty = leg.quantity * (leg.contractMultiplier ?? 1);
  const premium = leg.entryPrice * qty;
  const above = leg.type === 'call';
  const be = above ? leg.strike + leg.entryPrice : leg.strike - leg.entryPrice;
  const side = above ? 'above' : 'below';
  if (leg.direction === 'buy') {
    return `You pay ${fmtUsd(premium)} now. It pays out if ${underlying} ends ${side} ${fmtPrice(leg.strike)}, and you're in profit past ${fmtPrice(be)}. The most you can lose is the ${fmtUsd(premium)} you paid.`;
  }
  return `You collect ${fmtUsd(premium)} now. You keep it if ${underlying} stays ${above ? 'below' : 'above'} ${fmtPrice(leg.strike)}, and you start losing money if it ends ${side} ${fmtPrice(be)}.`;
}

const STRATEGY_BLURBS: Record<string, string> = {
  'Long Call': 'A bet that the price goes up. Your risk is limited to what you paid.',
  'Long Put': 'A bet that the price goes down. Your risk is limited to what you paid.',
  'Short Call': 'You get paid to bet the price will NOT rise much. Losses can be unlimited if it rallies.',
  'Short Put': 'You get paid to bet the price will NOT fall much. A big drop can mean a big loss.',
  'Bull Call Spread': 'A cheaper bet on the price going up. Both your profit and your loss are capped.',
  'Bear Call Spread': 'You get paid upfront if the price stays below a level. Both profit and loss are capped.',
  'Bear Put Spread': 'A cheaper bet on the price going down. Both your profit and your loss are capped.',
  'Bull Put Spread': 'You get paid upfront if the price stays above a level. Both profit and loss are capped.',
  'Long Straddle': 'A bet on a BIG move in either direction. You lose if the price stays still.',
  'Long Strangle': 'A cheaper bet on a BIG move in either direction. The move needs to be bigger.',
  'Short Straddle': 'You get paid if the price stays calm. A big move either way can mean a big loss.',
  'Short Strangle': 'You get paid if the price stays inside a range. A big move can mean a big loss.',
  'Iron Condor': 'You get paid if the price stays inside a range. Losses are capped on both sides.',
  'Iron Butterfly': 'You get paid if the price pins near one level. Losses are capped on both sides.',
  'Call Butterfly': 'A cheap bet that the price ends near the middle strike.',
  'Put Butterfly': 'A cheap bet that the price ends near the middle strike.',
};

export function describeStrategy(name: string): string {
  return (
    STRATEGY_BLURBS[name] ??
    'A custom combination. Read the green and red zones on the chart: green is where you make money at expiry.'
  );
}
