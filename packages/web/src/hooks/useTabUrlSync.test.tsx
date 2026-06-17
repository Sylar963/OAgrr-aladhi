// @vitest-environment jsdom
import { useAppStore } from '@stores/app-store';
import { act, renderHook } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTabUrlSync } from './useTabUrlSync';

function resetStore(): void {
  useAppStore.setState({
    underlying: 'BTC',
    expiry: '',
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

  it('adopts a crypto deep link (tab + ticker)', () => {
    window.location.hash = '#volatility/ETH';
    renderHook(() => useTabUrlSync(), { wrapper: StrictMode });
    const s = useAppStore.getState();
    expect(s.assetMode).toBe('crypto');
    expect(s.activeTab).toBe('surface');
    expect(s.underlying).toBe('ETH');
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
