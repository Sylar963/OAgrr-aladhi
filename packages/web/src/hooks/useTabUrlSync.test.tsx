// @vitest-environment jsdom
import { MAIN_MARKET_ID, selectActiveMarket, useAppStore } from '@stores/app-store';
import { act, renderHook } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTabUrlSync } from './useTabUrlSync';
import { setTestMarket } from '@/test/market-state';

function resetStore(): void {
  setTestMarket({ underlying: 'BTC', expiry: '' });
  useAppStore.setState({
    activeTab: 'chain',
    assetMode: 'crypto',
    tradfiUnderlying: '',
    tradfiExpiry: '',
    tradfiPage: 'chain',
  });
}

describe('useTabUrlSync', () => {
  beforeEach(() => {
    resetStore();
    window.location.hash = '';
  });
  afterEach(() => {
    window.location.hash = '';
  });

  it('adopts a TradFi deep link into the store without clobbering the hash (StrictMode-safe)', () => {
    window.location.hash = '#tradfi/gex/AAPL';
    renderHook(() => useTabUrlSync(), { wrapper: StrictMode });
    const s = useAppStore.getState();
    expect(s.assetMode).toBe('tradfi');
    expect(s.tradfiPage).toBe('gex');
    expect(s.tradfiUnderlying).toBe('AAPL');
    expect(window.location.hash).toBe('#tradfi/gex/AAPL');
  });

  it('adopts a TradFi Builder deep link', () => {
    window.location.hash = '#tradfi/builder/SPY';
    renderHook(() => useTabUrlSync(), { wrapper: StrictMode });
    const state = useAppStore.getState();
    expect(state.assetMode).toBe('tradfi');
    expect(state.tradfiPage).toBe('builder');
    expect(state.tradfiUnderlying).toBe('SPY');
  });

  it('adopts a crypto deep link (tab + ticker)', () => {
    window.location.hash = '#volatility/ETH';
    renderHook(() => useTabUrlSync(), { wrapper: StrictMode });
    const s = useAppStore.getState();
    expect(s.assetMode).toBe('crypto');
    expect(s.activeTab).toBe('surface');
    expect(selectActiveMarket(s).underlying).toBe('ETH');
    expect(window.location.hash).toBe('#volatility/ETH');
  });

  it('seeds a canonical hash on a fresh load with no hash', () => {
    renderHook(() => useTabUrlSync(), { wrapper: StrictMode });
    expect(window.location.hash).toBe('#chain/BTC');
  });

  it('replaces (not pushes) on a ticker-only change', () => {
    window.location.hash = '#chain/BTC';
    renderHook(() => useTabUrlSync(), { wrapper: StrictMode });
    const push = vi.spyOn(window.history, 'pushState');
    act(() => {
      useAppStore.getState().setUnderlying('ETH');
    });
    expect(window.location.hash).toBe('#chain/ETH');
    expect(push).not.toHaveBeenCalled();
    push.mockRestore();
  });

  it('pushes a history entry on a view (tab) change', () => {
    window.location.hash = '#chain/BTC';
    renderHook(() => useTabUrlSync(), { wrapper: StrictMode });
    const push = vi.spyOn(window.history, 'pushState');
    act(() => {
      useAppStore.getState().setActiveTab('surface');
    });
    expect(window.location.hash).toBe('#volatility/BTC');
    expect(push).toHaveBeenCalledTimes(1);
    push.mockRestore();
  });
});

describe('useTabUrlSync with custom tabs', () => {
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    localStorage.clear();
    resetStore();
    useAppStore.setState({ customTabs: [], activeMarketId: MAIN_MARKET_ID });
    window.matchMedia = vi.fn(() => ({ matches: false })) as unknown as typeof window.matchMedia;
    window.location.hash = '';
  });
  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    window.location.hash = '';
  });

  function makeTab(): string {
    useAppStore.getState().createCustomTab('Desk');
    const id = useAppStore.getState().activeMarketId;
    useAppStore.setState({ activeMarketId: MAIN_MARKET_ID });
    return id;
  }

  it('opens a known custom tab from a deep link and applies the ticker to it', () => {
    const id = makeTab();
    window.location.hash = `#w/${id}/ETH`;
    renderHook(() => useTabUrlSync(), { wrapper: StrictMode });

    const s = useAppStore.getState();
    expect(s.activeMarketId).toBe(id);
    expect(selectActiveMarket(s).underlying).toBe('ETH');
    expect(s.markets[MAIN_MARKET_ID].underlying).toBe('BTC');
  });

  it('falls back to the default tab for a custom tab this device does not have', () => {
    window.location.hash = '#w/missing/ETH';
    renderHook(() => useTabUrlSync());

    const s = useAppStore.getState();
    expect(s.activeMarketId).toBe(MAIN_MARKET_ID);
    expect(s.activeTab).toBe('chain');
  });

  it('falls back to the default tab on mobile', () => {
    const id = makeTab();
    window.matchMedia = vi.fn(() => ({ matches: true })) as unknown as typeof window.matchMedia;
    window.location.hash = `#w/${id}/ETH`;
    renderHook(() => useTabUrlSync());

    expect(useAppStore.getState().activeMarketId).toBe(MAIN_MARKET_ID);
  });

  it('writes the custom tab into the hash and leaves it for a fixed tab', () => {
    const id = makeTab();
    window.location.hash = '#chain/BTC';
    renderHook(() => useTabUrlSync());

    act(() => useAppStore.getState().openCustomTab(id));
    expect(window.location.hash).toBe(`#w/${id}/BTC`);

    act(() => useAppStore.getState().setActiveTab('gex'));
    expect(window.location.hash).toBe('#gex/BTC');
  });

  it('leaves the custom tab when the hash points at a fixed one', () => {
    const id = makeTab();
    window.location.hash = `#w/${id}/BTC`;
    renderHook(() => useTabUrlSync());
    expect(useAppStore.getState().activeMarketId).toBe(id);

    act(() => {
      window.location.hash = '#chain/BTC';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });

    expect(useAppStore.getState().activeMarketId).toBe(MAIN_MARKET_ID);
    expect(useAppStore.getState().activeTab).toBe('chain');
  });
});
