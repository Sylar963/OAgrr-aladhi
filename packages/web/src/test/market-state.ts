import { MAIN_MARKET_ID, type MarketContext, useAppStore } from '@stores/app-store';

export function setTestMarket(patch: Partial<MarketContext>): void {
  useAppStore.setState((s) => ({
    activeMarketId: MAIN_MARKET_ID,
    markets: { [MAIN_MARKET_ID]: { ...s.markets[MAIN_MARKET_ID], ...patch } },
  }));
}
