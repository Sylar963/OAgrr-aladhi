/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';

import { selectActiveMarket, useAppStore } from '@stores/app-store';
import { setTestMarket } from '@/test/market-state';

const useChainWsMock = vi.fn();
const useExpiriesMock = vi.fn();

vi.mock('@features/chain/queries', () => ({
  useExpiries: (...args: unknown[]) => useExpiriesMock(...args),
}));

vi.mock('./useChainWs', () => ({
  useChainWs: (...args: unknown[]) => useChainWsMock(...args),
}));

const { useGlobalFeedStatus } = await import('./useGlobalFeedStatus');

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

describe('useGlobalFeedStatus', () => {
  beforeEach(() => {
    setTestMarket({ underlying: 'BTC', expiry: '', activeVenues: ['deribit'] });
    useAppStore.setState({
      feedStatus: {
        connectionState: 'closed',
        failedVenueCount: 0,
        failedVenueIds: [],
        failedVenues: [],
        venueStates: {},
        staleMs: null,
        venueLagMs: {},
        lastUpdateMs: null,
      },
    });

    useExpiriesMock.mockReset();
    useChainWsMock.mockReset();

    useExpiriesMock.mockReturnValue({
      data: { expiries: ['2026-03-27'] },
    });
    useChainWsMock.mockReturnValue({
      connectionState: 'live',
      staleMs: 42,
      lastSeq: 7,
      failedVenues: [{ venue: 'okx', reason: 'down' }],
      venueStates: {},
    });
  });

  it('seeds the first expiry when the store has none', () => {
    renderHook(() => useGlobalFeedStatus(), { wrapper: createWrapper() });

    expect(selectActiveMarket(useAppStore.getState()).expiry).toBe('2026-03-27');
  });

  it('writes live feed status into the app store', () => {
    renderHook(() => useGlobalFeedStatus(), { wrapper: createWrapper() });

    expect(useAppStore.getState().feedStatus).toMatchObject({
      connectionState: 'live',
      failedVenueCount: 1,
      failedVenueIds: ['okx'],
      failedVenues: [{ venue: 'okx', reason: 'down' }],
      staleMs: 42,
    });
    expect(useAppStore.getState().feedStatus.lastUpdateMs).toBeTypeOf('number');
  });

  it('does not overwrite global feed status when disabled', () => {
    useAppStore.setState((s) => ({
      feedStatus: { ...s.feedStatus, connectionState: 'live', staleMs: 1 },
    }));
    useChainWsMock.mockReturnValue({
      connectionState: 'closed',
      staleMs: null,
      lastSeq: 0,
      failedVenues: [],
      venueStates: {},
    });

    renderHook(() => useGlobalFeedStatus(false), { wrapper: createWrapper() });

    expect(useAppStore.getState().feedStatus.connectionState).toBe('live');
  });
});
