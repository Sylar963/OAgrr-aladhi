/**
 * @vitest-environment jsdom
 */

import { useAppStore } from '@stores/app-store';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SERVER_UPDATE_RELOAD_DELAY_MS, useServerVersion } from './useServerVersion';

beforeEach(() => {
  useAppStore.setState({
    sessionNotice: null,
    announcement: null,
    activeTab: 'flow',
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
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useServerVersion', () => {
  it('writes the announcement from /health into the store', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          bootTime: 1,
          announcement: { id: 'm1', severity: 'info', title: 'Hi' },
        }),
      }),
    );

    const { unmount } = renderHook(() => useServerVersion());
    await waitFor(() => {
      expect(useAppStore.getState().announcement).toMatchObject({ id: 'm1', severity: 'info' });
    });
    unmount();
  });

  it('clears the announcement when /health has none', async () => {
    useAppStore.setState({
      announcement: { id: 'old', severity: 'info', blocking: false, title: 'Old' },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ bootTime: 1 }) }),
    );

    const { unmount } = renderHook(() => useServerVersion());
    await waitFor(() => {
      expect(useAppStore.getState().announcement).toBeNull();
    });
    unmount();
  });

  it('writes venue feed health into global feed status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          bootTime: 1,
          feeds: {
            summary: { totalVenues: 2, connectedVenues: 2, lastAnyMessageAgeMs: 25 },
            venues: [
              { venue: 'deribit', connected: true, lastMessageAgeMs: 25 },
              { venue: 'okx', connected: true, lastMessageAgeMs: 40 },
            ],
          },
        }),
      }),
    );

    const { unmount } = renderHook(() => useServerVersion());
    await waitFor(() => {
      expect(useAppStore.getState().feedStatus).toMatchObject({
        connectionState: 'live',
        failedVenueCount: 0,
        failedVenueIds: [],
        staleMs: 25,
        venueStates: { deribit: 'live', okx: 'live' },
      });
    });
    unmount();
  });

  it('does not overwrite chain WebSocket status while the chain tab is active', async () => {
    useAppStore.setState((s) => ({
      activeTab: 'chain',
      feedStatus: { ...s.feedStatus, connectionState: 'stale', staleMs: 600_000 },
    }));
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          bootTime: 1,
          feeds: {
            summary: { totalVenues: 2, connectedVenues: 2, lastAnyMessageAgeMs: 0 },
            venues: [
              { venue: 'deribit', connected: true, lastMessageAgeMs: 0 },
              { venue: 'okx', connected: true, lastMessageAgeMs: 0 },
            ],
          },
        }),
      }),
    );

    const { unmount } = renderHook(() => useServerVersion());
    await waitFor(() => {
      expect(fetch).toHaveBeenCalled();
    });

    expect(useAppStore.getState().feedStatus).toMatchObject({
      connectionState: 'stale',
      staleMs: 600_000,
    });
    unmount();
  });

  it('schedules a delayed reload when the server bootTime changes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ bootTime: 1 }) })
      .mockResolvedValue({ ok: true, json: async () => ({ bootTime: 2 }) });
    vi.stubGlobal('fetch', fetchMock);

    const { unmount } = renderHook(() => useServerVersion());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(useAppStore.getState().sessionNotice).toBeNull();

    const before = Date.now();
    await vi.advanceTimersByTimeAsync(30_000);
    await waitFor(() => {
      expect(useAppStore.getState().sessionNotice?.kind).toBe('server-updated');
    });
    const reloadAtMs = useAppStore.getState().sessionNotice?.reloadAtMs ?? 0;
    expect(reloadAtMs - before).toBeGreaterThanOrEqual(SERVER_UPDATE_RELOAD_DELAY_MS);
    unmount();
  });
});
