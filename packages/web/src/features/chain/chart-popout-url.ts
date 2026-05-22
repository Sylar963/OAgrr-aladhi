import type { VenueId } from '@oggregator/protocol';

export interface PopoutChartParams {
  venue: string;
  symbol: string;
  underlying: string;
  expiry: string;
  strike: number;
  type: 'call' | 'put';
  interval: string;
  range: string;
  mark: boolean;
  ma9: boolean;
  ma20: boolean;
  mode: 'price' | 'attribution';
}

export interface OpenChartPopoutArgs {
  venue: VenueId;
  symbol: string;
  underlying: string;
  expiry: string;
  strike: number;
  type: 'call' | 'put';
}

export function parsePopoutParams(search: string): PopoutChartParams | null {
  const params = new URLSearchParams(search);
  if (params.get('popout') !== '1') return null;
  const venue = params.get('venue');
  const symbol = params.get('symbol');
  const underlying = params.get('underlying');
  const expiry = params.get('expiry');
  const strikeStr = params.get('strike');
  const type = params.get('type');
  const interval = params.get('interval');
  const range = params.get('range');
  const mode = params.get('mode');
  if (!venue || !symbol || !underlying || !expiry || !strikeStr || !type || !interval || !range || !mode) return null;
  if (type !== 'call' && type !== 'put') return null;
  if (mode !== 'price' && mode !== 'attribution') return null;
  const strike = Number(strikeStr);
  if (!Number.isFinite(strike)) return null;
  return {
    venue,
    symbol,
    underlying,
    expiry,
    strike,
    type,
    interval,
    range,
    mark: params.get('mark') === '1',
    ma9: params.get('ma9') === '1',
    ma20: params.get('ma20') === '1',
    mode,
  };
}

export function openChartPopout(args: OpenChartPopoutArgs): Window | null {
  const params = new URLSearchParams({
    popout: '1',
    venue: args.venue,
    symbol: args.symbol,
    underlying: args.underlying,
    expiry: args.expiry,
    strike: String(args.strike),
    type: args.type,
    interval: '1h',
    range: '7d',
    mark: '1',
    ma9: '1',
    ma20: '1',
    mode: 'price',
  });
  const url = `${window.location.origin}/?${params.toString()}`;
  // Stable per-(venue, symbol) name: clicking Chart again on the same strike
  // focuses the existing window instead of spawning a duplicate. Different
  // strike → different name → new window.
  const windowName = `chart-${args.venue}-${args.symbol}`;
  const win = window.open(url, windowName, 'popup=yes,width=720,height=480');
  if (win) win.focus();
  return win;
}
