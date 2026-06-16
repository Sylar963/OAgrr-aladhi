import type { OptionRight } from '@features/chain';

export interface TradfiPopoutArgs {
  underlying: string;
  expiry: string;
  strike: number;
  type: OptionRight;
}

export interface TradfiPopoutParams extends TradfiPopoutArgs {
  interval: string;
  range: string;
  mode: 'price' | 'attribution';
}

export function buildTradfiPopoutSearch(args: TradfiPopoutArgs): string {
  return new URLSearchParams({
    popout: '1',
    provider: 'tradfi',
    underlying: args.underlying,
    expiry: args.expiry,
    strike: String(args.strike),
    type: args.type,
    interval: '1h',
    range: '7d',
    mode: 'price',
  }).toString();
}

export function parseTradfiPopoutParams(search: string): TradfiPopoutParams | null {
  const p = new URLSearchParams(search);
  if (p.get('popout') !== '1' || p.get('provider') !== 'tradfi') return null;
  const underlying = p.get('underlying');
  const expiry = p.get('expiry');
  const strikeStr = p.get('strike');
  const type = p.get('type');
  if (!underlying || !expiry || !strikeStr || (type !== 'call' && type !== 'put')) return null;
  const strike = Number(strikeStr);
  if (!Number.isFinite(strike) || strike <= 0) return null;
  const mode = p.get('mode') === 'attribution' ? 'attribution' : 'price';
  return {
    underlying,
    expiry,
    strike,
    type,
    interval: p.get('interval') ?? '1h',
    range: p.get('range') ?? '7d',
    mode,
  };
}

// Stable per-(underlying, expiry, strike, type) window name: clicking Chart again
// on the same option focuses the existing window instead of spawning a duplicate.
export function openTradfiChartPopout(args: TradfiPopoutArgs): Window | null {
  const url = `${window.location.origin}/?${buildTradfiPopoutSearch(args)}`;
  const name = `tradfi-chart-${args.underlying}-${args.expiry}-${args.strike}-${args.type}`;
  const win = window.open(url, name, 'popup=yes,width=720,height=520');
  if (win) win.focus();
  return win;
}
