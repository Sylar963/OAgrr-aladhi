import type { ChartPanel } from './chart-panels-store.js';

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

export function buildPopoutUrl(panel: ChartPanel): string {
  const params = new URLSearchParams({
    popout: '1',
    venue: panel.venue,
    symbol: panel.symbol,
    underlying: panel.underlying,
    expiry: panel.expiry,
    strike: String(panel.strike),
    type: panel.type,
    interval: panel.interval,
    range: panel.range,
    mark: panel.overlays.mark ? '1' : '0',
    ma9: panel.overlays.ma9 ? '1' : '0',
    ma20: panel.overlays.ma20 ? '1' : '0',
    mode: panel.chartMode,
  });
  return `${window.location.origin}/?${params.toString()}`;
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

export function openPanelPopout(panel: ChartPanel, close: (id: string) => void): void {
  const url = buildPopoutUrl(panel);
  const features = `popup=yes,width=${Math.max(560, panel.w)},height=${Math.max(420, panel.h + 80)}`;
  const win = window.open(url, `chart-popout-${panel.id}`, features);
  if (!win) {
    // Popup blocked — leave the panel in place so the user can still interact with it
    return;
  }
  close(panel.id);
}
