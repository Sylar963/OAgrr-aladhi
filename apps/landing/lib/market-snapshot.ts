import { fetchSpots } from './api';

export interface SpotQuote {
  priceLabel: string;
  changeLabel: string;
}

export interface MarketSnapshot {
  spots: Partial<Record<'BTC' | 'ETH', SpotQuote>>;
}

const SYMBOL_TO_BASE: Record<string, 'BTC' | 'ETH'> = {
  BTCUSDT: 'BTC',
  ETHUSDT: 'ETH',
};

function formatPrice(price: number): string {
  return `$${(price / 1000).toFixed(1)}K`;
}

function formatChange(pct: number): string {
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${(pct * 100).toFixed(1)}%`;
}

// Maps the live /api/spots response into the TopTicker's BTC/ETH labels. On any
// failure fetchSpots returns null and this yields empty spots, so the ticker
// simply omits the spot rows.
export async function getMarketSnapshot(): Promise<MarketSnapshot> {
  const items = await fetchSpots();
  if (!items) return { spots: {} };

  const spots: MarketSnapshot['spots'] = {};
  for (const item of items) {
    const base = SYMBOL_TO_BASE[item.symbol];
    if (base) {
      spots[base] = {
        priceLabel: formatPrice(item.lastPrice),
        changeLabel: formatChange(item.change24hPct),
      };
    }
  }
  return { spots };
}
