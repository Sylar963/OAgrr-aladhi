/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import { useAppStore } from '@stores/app-store';
import { useFeedToasts } from './useFeedToasts';

function setConn(state: string) {
  act(() => {
    useAppStore.setState((s) => ({ feedStatus: { ...s.feedStatus, connectionState: state as never } }));
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  useAppStore.setState((s) => ({
    feedStatus: { ...s.feedStatus, connectionState: 'live', failedVenueIds: [] },
    activeVenues: ['deribit'],
    toasts: [],
    feedDegraded: false,
  }));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useFeedToasts', () => {
  it('pushes a reconnecting toast when the socket drops to reconnecting', () => {
    renderHook(() => useFeedToasts());
    setConn('reconnecting');
    expect(useAppStore.getState().toasts.some((t) => t.text.includes('Reconnecting'))).toBe(true);
  });

  it('sets feedDegraded after 8s of trouble and clears + toasts on recovery', () => {
    renderHook(() => useFeedToasts());
    setConn('reconnecting');
    act(() => { vi.advanceTimersByTime(8000); });
    expect(useAppStore.getState().feedDegraded).toBe(true);

    setConn('live');
    expect(useAppStore.getState().feedDegraded).toBe(false);
    expect(useAppStore.getState().toasts.some((t) => t.text.includes('restored'))).toBe(true);
  });

  it('does not mark degraded for a brief blip under 8s', () => {
    renderHook(() => useFeedToasts());
    setConn('reconnecting');
    act(() => { vi.advanceTimersByTime(3000); });
    setConn('live');
    act(() => { vi.advanceTimersByTime(8000); });
    expect(useAppStore.getState().feedDegraded).toBe(false);
  });

  it('does not toast "restored" on initial cold-start connect', () => {
    useAppStore.setState((s) => ({ feedStatus: { ...s.feedStatus, connectionState: 'closed' } }));
    renderHook(() => useFeedToasts());
    setConn('live');
    expect(useAppStore.getState().toasts.some((t) => t.text.includes('restored'))).toBe(false);
    expect(useAppStore.getState().feedDegraded).toBe(false);
  });
});
